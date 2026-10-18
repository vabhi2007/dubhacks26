// Owner: A. purchase() — the only path from "an agent wants to buy" to an order (DESIGN.md §4, §8.2). Guardrails in code:
//   1. amount > user's confirmAboveCents → approval (nothing is spent).
//   2. else authorize() on the mandate — which must belong to this user and be issued to this agent — inside a
//      transaction: mandate spend + order + `purchase` event commit together.
//   3. mandate declines → `mandate_declined` event + approval.
// Approving re-enters charge() as the agent that asked: the human's YES satisfies (1); if that agent's mandate can't cover
// it, the approval mints a single-use mandate for exactly that purchase, so money still only moves through authorize().
import { collections, getClient, merchantIdFor, newId } from "@alfred/shared/db";
import { AgentName, Surface, type Approval, type ApprovalDecision, type Card, type Mandate, type Offer, type Order, type Product, type User } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { pendingApproval, requestApproval, resolveWithoutPurchase, type ApprovalDoc } from "./approvals";
import { pickCard, rewardFor } from "./cards";
import { emit } from "./events";
import { authorize, whyDeclined } from "./mandates";
import { isDuplicateKey, OMIT_UNDEFINED, usd } from "./util";

const ONE_TIME_MANDATE_TTL_MS = 15 * 60_000;

// Validated at runtime too: callers include LLM tool calls.
const PurchaseInput = z.object({
  userId: z.string().min(1),
  offerId: z.string().min(1), // amount is always the offer's current price — never caller-supplied
  mandateId: z.string().min(1), // must be issued to `agent`
  agent: AgentName.default("orchestrator"), // who is buying; also feed attribution
  surface: Surface.default("system"), // where it was triggered
  cardId: z.string().min(1).optional(), // Smart Pay's pick — only honored when the mandate isn't bound to one of the user's cards
  idempotencyKey: z.string().min(1).optional(), // e.g. `price_drop:${event._id}` — a repeat returns the first order/approval
});
export type PurchaseInput = z.input<typeof PurchaseInput>;

export type PurchaseResult =
  | { status: "purchased"; order: Order; mandate: Mandate }
  | { status: "needs_approval"; approval: Approval } // above the confirm threshold (or a prior approval for this idempotencyKey)
  | { status: "declined"; reason: string; approval: Approval }; // mandate said no → asked the human instead

/** Internal order fields beyond the frozen Order contract. */
type OrderDoc = Order & { savedCents: number; approvalId?: string; idempotencyKey?: string };

type Ctx = { user: User; offer: Offer; product: Product; merchantId: string; cards: Card[] };

async function load(userId: string, offerId: string): Promise<Ctx> {
  const c = await collections();
  const offer = await c.offers.findOne({ _id: offerId });
  if (!offer) throw new HTTPException(404, { message: `offer ${offerId} not found` });
  const [user, product, cards] = await Promise.all([
    c.users.findOne({ _id: userId }),
    c.products.findOne({ _id: offer.productId }, { projection: { embedding: 0 } }),
    c.cards.find({ userId }).toArray(),
  ]);
  if (!user) throw new HTTPException(404, { message: `user ${userId} not found` });
  if (!product) throw new HTTPException(404, { message: `product ${offer.productId} not found` });
  return { user, offer, product, merchantId: merchantIdFor(offer.seller), cards };
}

/** "Typical" price for savings: median current price of new, exact-match US offers. */
async function referencePrice(productId: string) {
  const c = await collections();
  const prices = (await c.offers.find({ productId, condition: "new", matched: "exact", region: "US" }).toArray()).map((o) => o.priceCents).sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)] ?? 0;
}

async function priorOrder(userId: string, idempotencyKey: string) {
  const c = await collections();
  const order = await c.orders.findOne<OrderDoc>({ userId, idempotencyKey } as Partial<OrderDoc>);
  if (!order) return null;
  const mandate = await c.mandates.findOne({ _id: order.mandateId, userId });
  if (!mandate) throw new HTTPException(409, { message: `order ${order._id} has no mandate` });
  return { order, mandate };
}

export async function purchase(raw: PurchaseInput): Promise<PurchaseResult> {
  const input = PurchaseInput.parse(raw);
  const { userId, agent, surface, idempotencyKey } = input;
  const c = await collections();
  if (idempotencyKey) {
    const prior = await priorOrder(userId, idempotencyKey);
    if (prior) return { status: "purchased", ...prior };
    const asked = await c.approvals.findOne<ApprovalDoc>({ userId, idempotencyKey } as Partial<ApprovalDoc>);
    if (asked) return { status: "needs_approval", approval: asked };
  }
  const ctx = await load(userId, input.offerId);
  const { user, offer, product } = ctx;
  const amountCents = offer.priceCents;
  const ask = (mandateId?: string) =>
    requestApproval({ userId, amountCents, productId: product._id, offerId: offer._id, mandateId, agent, surface, idempotencyKey });

  if (amountCents > user.settings.confirmAboveCents) return { status: "needs_approval", approval: await ask(input.mandateId) };

  const done = await charge({ ctx, amountCents, mandateId: input.mandateId, cardId: input.cardId, agent, surface, idempotencyKey });
  if (done) return { status: "purchased", ...done };

  const reason = await whyDeclined(input.mandateId, amountCents, ctx.merchantId, product.category, { userId, agent });
  const mandate = await c.mandates.findOne({ _id: input.mandateId, userId });
  await emit({
    userId, agent, surface, type: "mandate_declined",
    summary: `${mandate?.label ?? "Mandate"} declined ${usd(amountCents)} for ${product.title} — ${reason}. Asking you instead.`,
    refs: { productId: product._id, mandateId: mandate?._id },
  });
  return { status: "declined", reason, approval: await ask() };
}

/** Approve (→ charge) or deny one of the user's pending approvals. Exactly-once: the pending→approved flip commits with the order. */
export async function resolveApproval(id: string, decision: ApprovalDecision, userId: string): Promise<{ approval: Approval; order?: Order }> {
  const a = await pendingApproval(id, userId);
  if (decision.decision === "deny" || a.kind !== "purchase") return { approval: await resolveWithoutPurchase(a, decision) };
  if (!a.offerId) throw new HTTPException(409, { message: `approval ${a.shortCode} has no offer` });
  const ctx = await load(a.userId, a.offerId);
  const done = await charge({
    ctx, amountCents: a.amountCents, mandateId: a.mandateId, agent: a.agent ?? "orchestrator", surface: decision.channel,
    idempotencyKey: a.idempotencyKey, approval: { id: a._id, channel: decision.channel },
  });
  const approval = (await (await collections()).approvals.findOne({ _id: a._id, userId }))!;
  return { approval, order: done!.order };
}

type ChargeArgs = {
  ctx: Ctx;
  amountCents: number;
  mandateId?: string;
  cardId?: string;
  agent: AgentName;
  surface: Surface;
  idempotencyKey?: string;
  approval?: { id: string; channel: Approval["channel"] };
};

/** Returns null (nothing written) when the mandate declines and there's no human approval to fall back on. */
async function charge(a: ChargeArgs): Promise<{ order: Order; mandate: Mandate } | null> {
  const c = await collections();
  const { user, offer, product, merchantId, cards } = a.ctx;
  const scope = { userId: user._id, agent: a.agent };
  const refPrice = await referencePrice(product._id);
  const session = (await getClient()).startSession();
  try {
    return await session.withTransaction(async () => {
      const now = new Date();
      if (a.approval) {
        const flipped = await c.approvals.findOneAndUpdate(
          { _id: a.approval.id, userId: user._id, status: "pending", expiresAt: { $gt: now } },
          { $set: { status: "approved", resolvedAt: now, channel: a.approval.channel } },
          { session },
        );
        if (!flipped) throw new HTTPException(409, { message: "approval is no longer pending" });
      }

      let mandate = a.mandateId ? await authorize(a.mandateId, a.amountCents, merchantId, product.category, { ...scope, session }) : null;
      if (!mandate) {
        if (!a.approval) return null;
        // The human approved this exact purchase: mint a single-use mandate for it, on the original mandate's card if any.
        const original = a.mandateId ? await c.mandates.findOne({ _id: a.mandateId, userId: user._id }, { session }) : null;
        const once: Mandate = {
          _id: newId("mnd"), userId: user._id, agent: a.agent, label: `One-time: ${product.title}`,
          capCents: a.amountCents, spentCents: 0, categories: [product.category], merchants: [merchantId],
          expiresAt: new Date(now.getTime() + ONE_TIME_MANDATE_TTL_MS), status: "active",
          card: { last4: pickCard(cards, product.category, original).last4, token: newId("tok") },
        };
        await c.mandates.insertOne(once, { session });
        mandate = await authorize(once._id, a.amountCents, merchantId, product.category, { ...scope, session });
        if (!mandate) throw new Error("one-time mandate failed to authorize");
      }

      const card = pickCard(cards, product.category, mandate, a.cardId);
      const order: OrderDoc = {
        _id: newId("ord"), userId: user._id, productId: product._id, offerId: offer._id, mandateId: mandate._id, cardId: card._id,
        amountCents: a.amountCents, rewardEarnedCents: rewardFor(card, product.category, a.amountCents), ts: now,
        savedCents: Math.max(0, refPrice - a.amountCents), approvalId: a.approval?.id, idempotencyKey: a.idempotencyKey,
      };
      await c.orders.insertOne(order, { session, ...OMIT_UNDEFINED });
      if (a.approval)
        await emit({
          userId: user._id, agent: a.approval.channel === "web" ? "orchestrator" : "messenger", surface: a.approval.channel, type: "approval_resolved",
          summary: `You approved ${usd(a.amountCents)} for ${product.title}`,
          refs: { approvalId: a.approval.id, productId: product._id, mandateId: mandate._id },
        }, { session });
      await emit({
        userId: user._id, agent: a.agent, surface: a.surface, type: "purchase",
        summary: `Bought ${product.title} for ${usd(a.amountCents)} at ${offer.seller} on Visa ••${card.last4} (+${usd(order.rewardEarnedCents)} back)`,
        refs: { productId: product._id, mandateId: mandate._id, orderId: order._id, approvalId: a.approval?.id },
      }, { session });
      return { order, mandate };
    });
  } catch (e) {
    if (a.idempotencyKey && isDuplicateKey(e)) {
      const prior = await priorOrder(user._id, a.idempotencyKey);
      if (prior) return prior;
    }
    throw e;
  } finally {
    await session.endSession();
  }
}
