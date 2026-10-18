// Owner: A. purchase() — the only path from "an agent wants to buy" to an order (DESIGN.md §4, §8.2). Guardrails in code:
//   1. amount > user's confirmAboveCents → approval (nothing is spent).
//   2. else authorize() on the mandate inside a transaction: mandate spend + order + `purchase` event commit together.
//   3. mandate declines → `mandate_declined` event + approval.
// Approving re-enters charge(): the human's YES satisfies (1); if the agent's mandate can't cover it, the approval mints a
// single-use mandate for exactly that purchase, so money still only moves through authorize().
import { collections, getClient, merchantIdFor, newId } from "@alfred/shared/db";
import type { AgentName, Approval, ApprovalDecision, Card, Mandate, Offer, Order, Product, Surface, User } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { pendingApproval, requestApproval, resolveWithoutPurchase } from "./approvals";
import { pickCard, rewardFor } from "./cards";
import { emit } from "./events";
import { authorize, whyDeclined } from "./mandates";
import { isDuplicateKey, usd } from "./util";

const ONE_TIME_MANDATE_TTL_MS = 15 * 60_000;

export type PurchaseInput = {
  userId: string;
  offerId: string; // amount is always the offer's current price — never caller-supplied
  mandateId: string;
  agent?: AgentName; // who is buying (feed attribution), default "orchestrator"
  surface?: Surface; // where it was triggered, default "system"
  cardId?: string; // Smart Pay's pick; default: the mandate's card, else the best multiplier for the category
  idempotencyKey?: string; // e.g. `price_drop:${event._id}` — a repeat returns the first order instead of buying twice
};

export type PurchaseResult =
  | { status: "purchased"; order: Order; mandate: Mandate }
  | { status: "needs_approval"; approval: Approval } // above the confirm threshold
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

export async function purchase(input: PurchaseInput): Promise<PurchaseResult> {
  const c = await collections();
  const agent = input.agent ?? "orchestrator";
  const surface = input.surface ?? "system";
  if (input.idempotencyKey) {
    const prior = await c.orders.findOne({ idempotencyKey: input.idempotencyKey } as Partial<OrderDoc>);
    if (prior) return { status: "purchased", order: prior, mandate: (await c.mandates.findOne({ _id: prior.mandateId }))! };
  }
  const ctx = await load(input.userId, input.offerId);
  const { user, offer, product } = ctx;
  const amountCents = offer.priceCents;
  const ask = (mandateId?: string) =>
    requestApproval({ userId: user._id, amountCents, productId: product._id, offerId: offer._id, mandateId, agent, surface });

  if (amountCents > user.settings.confirmAboveCents) return { status: "needs_approval", approval: await ask(input.mandateId) };

  const done = await charge({ ctx, amountCents, mandateId: input.mandateId, cardId: input.cardId, agent, surface, idempotencyKey: input.idempotencyKey });
  if (done) return { status: "purchased", ...done };

  const reason = await whyDeclined(input.mandateId, amountCents, ctx.merchantId, product.category);
  const mandate = await c.mandates.findOne({ _id: input.mandateId });
  await emit({
    userId: user._id, agent, surface, type: "mandate_declined",
    summary: `${mandate?.label ?? "Mandate"} declined ${usd(amountCents)} for ${product.title} — ${reason}. Asking you instead.`,
    refs: { productId: product._id, mandateId: input.mandateId },
  });
  return { status: "declined", reason, approval: await ask() };
}

/** Approve (→ charge) or deny a pending approval. Exactly-once: the pending→approved flip commits with the order. */
export async function resolveApproval(id: string, decision: ApprovalDecision): Promise<{ approval: Approval; order?: Order }> {
  const a = await pendingApproval(id);
  if (decision.decision === "deny" || a.kind !== "purchase") return { approval: await resolveWithoutPurchase(a, decision) };
  if (!a.offerId) throw new HTTPException(409, { message: `approval ${a.shortCode} has no offer` });
  const c = await collections();
  const [ctx, asked] = await Promise.all([
    load(a.userId, a.offerId),
    c.agentEvents.findOne({ type: "approval_requested", "refs.approvalId": a._id }), // credit the agent that asked
  ]);
  const done = await charge({
    ctx, amountCents: a.amountCents, mandateId: a.mandateId, agent: asked?.agent ?? "orchestrator", surface: decision.channel,
    approval: { id: a._id, channel: decision.channel },
  });
  const approval = (await c.approvals.findOne({ _id: id }))!;
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
  const refPrice = await referencePrice(product._id);
  const session = (await getClient()).startSession();
  try {
    return await session.withTransaction(async () => {
      const now = new Date();
      if (a.approval) {
        const flipped = await c.approvals.findOneAndUpdate(
          { _id: a.approval.id, status: "pending", expiresAt: { $gt: now } },
          { $set: { status: "approved", resolvedAt: now, channel: a.approval.channel } },
          { session },
        );
        if (!flipped) throw new HTTPException(409, { message: "approval is no longer pending" });
      }

      let mandate = a.mandateId ? await authorize(a.mandateId, a.amountCents, merchantId, product.category, session) : null;
      if (!mandate) {
        if (!a.approval) return null;
        // The human approved this exact purchase: mint a single-use mandate for it, on the original mandate's card if any.
        const original = a.mandateId ? await c.mandates.findOne({ _id: a.mandateId }, { session }) : null;
        const once: Mandate = {
          _id: newId("mnd"), userId: user._id, agent: a.agent, label: `One-time: ${product.title}`,
          capCents: a.amountCents, spentCents: 0, categories: [product.category], merchants: [merchantId],
          expiresAt: new Date(now.getTime() + ONE_TIME_MANDATE_TTL_MS), status: "active",
          card: { last4: pickCard(cards, product.category, original).last4, token: newId("tok") },
        };
        await c.mandates.insertOne(once, { session });
        mandate = await authorize(once._id, a.amountCents, merchantId, product.category, session);
        if (!mandate) throw new Error("one-time mandate failed to authorize");
      }

      const card = pickCard(cards, product.category, mandate, a.cardId);
      const order: OrderDoc = {
        _id: newId("ord"), userId: user._id, productId: product._id, offerId: offer._id, mandateId: mandate._id, cardId: card._id,
        amountCents: a.amountCents, rewardEarnedCents: rewardFor(card, product.category, a.amountCents), ts: now,
        savedCents: Math.max(0, refPrice - a.amountCents), approvalId: a.approval?.id, idempotencyKey: a.idempotencyKey,
      };
      await c.orders.insertOne(order, { session });
      if (a.approval)
        await emit({
          userId: user._id, agent: a.approval.channel === "web" ? "orchestrator" : "messenger", surface: a.approval.channel, type: "approval_resolved",
          summary: `You approved ${usd(a.amountCents)} for ${product.title}`,
          refs: { approvalId: a.approval.id, productId: product._id, mandateId: mandate._id },
        }, { session });
      await emit({
        userId: user._id, agent: a.agent, surface: a.surface, type: "purchase",
        summary: `Bought ${product.title} for ${usd(a.amountCents)} at ${offer.seller} on Visa ••${mandate.card.last4} (+${usd(order.rewardEarnedCents)} back)`,
        refs: { productId: product._id, mandateId: mandate._id, orderId: order._id, approvalId: a.approval?.id },
      }, { session });
      return { order, mandate };
    });
  } catch (e) {
    if (a.idempotencyKey && isDuplicateKey(e)) {
      const prior = await c.orders.findOne({ idempotencyKey: a.idempotencyKey } as Partial<OrderDoc>);
      if (prior) return { order: prior, mandate: (await c.mandates.findOne({ _id: prior.mandateId }))! };
    }
    throw e;
  } finally {
    await session.endSession();
  }
}
