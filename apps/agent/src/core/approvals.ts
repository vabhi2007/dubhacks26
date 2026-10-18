// Owner: A. Human-in-the-loop requests. Inserting a pending approval triggers the Messenger (changeStreams.ts).
// Approving a purchase goes through purchase.ts (resolveApproval) so money still only moves via authorize().
import { collections, newId } from "@alfred/shared/db";
import type { AgentName, Approval, ApprovalDecision, Mandate, Offer, Product, Surface } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { pickCard, rewardFor } from "./cards";
import { emit } from "./events";
import { isDuplicateKey, OMIT_UNDEFINED, requireId, usd } from "./util";

const TTL_MS = 30 * 60_000;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_DIGITS = "23456789";

export type ApprovalRequest = {
  userId: string;
  amountCents: number;
  productId: string;
  offerId: string;
  mandateId?: string; // omit when no mandate can cover it — approving then mints a one-time mandate
  channel?: Approval["channel"];
  agent?: AgentName; // who is asking; approving charges as this agent
  surface?: Surface;
  idempotencyKey?: string; // one approval per trigger (e.g. a price_drop event), ever — re-asks return the first
};

/** Internal fields beyond the frozen Approval contract. */
export type ApprovalDoc = Approval & { agent?: AgentName; idempotencyKey?: string };

/** Approval plus what ApprovalCard needs: the funding card's last4 and the reward it would earn. */
export type ApprovalView = ApprovalDoc & { product?: Product; offer?: Offer; mandate?: Mandate; cardLast4?: string; rewardCents?: number };


/** Expiry is enforced in query filters; this flips stale pendings so they stop blocking the dedupe index. */
async function expireStale(userId: string) {
  const c = await collections();
  await c.approvals.updateMany({ userId, status: "pending", expiresAt: { $lte: new Date() } }, { $set: { status: "expired" } });
}

async function freeShortCode(userId: string) {
  const c = await collections();
  const taken = new Set((await c.approvals.find({ userId, status: "pending" }, { projection: { shortCode: 1 } }).toArray()).map((a) => a.shortCode));
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)]!;
  for (let i = 0; i < 50; i++) {
    const code = pick(CODE_LETTERS) + pick(CODE_DIGITS);
    if (!taken.has(code)) return code;
  }
  throw new Error("no free approval short code");
}

/**
 * Idempotent: an identical pending request (same user, product, offer, amount) returns the existing approval, and a
 * request with an `idempotencyKey` seen before returns that approval whatever its status (a NO isn't re-asked).
 */
export async function requestApproval(req: ApprovalRequest): Promise<ApprovalDoc> {
  const userId = requireId(req.userId, "userId");
  const productId = requireId(req.productId, "productId");
  const offerId = requireId(req.offerId, "offerId");
  if (!Number.isSafeInteger(req.amountCents) || req.amountCents <= 0) throw new HTTPException(400, { message: "amountCents must be a positive integer" });
  const c = await collections();
  const byKey = () => (req.idempotencyKey ? c.approvals.findOne<ApprovalDoc>({ userId, idempotencyKey: req.idempotencyKey }) : null);
  const prior = await byKey();
  if (prior) return prior;

  await expireStale(userId);
  const key = { userId, kind: "purchase" as const, status: "pending" as const, productId, offerId, amountCents: req.amountCents };
  const existing = await c.approvals.findOne(key);
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt++) {
    const approval: ApprovalDoc = {
      _id: newId("apr"), ...key, mandateId: req.mandateId, channel: req.channel ?? "imessage", shortCode: await freeShortCode(userId),
      expiresAt: new Date(Date.now() + TTL_MS), agent: req.agent ?? "orchestrator", idempotencyKey: req.idempotencyKey,
    };
    try {
      await c.approvals.insertOne(approval, OMIT_UNDEFINED);
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      const dup = (await byKey()) ?? (await c.approvals.findOne(key)); // another agent process won the race
      if (dup) return dup;
      continue; // short-code clash — retry
    }
    const [product, mandate] = await Promise.all([c.products.findOne({ _id: productId }), req.mandateId ? c.mandates.findOne({ _id: req.mandateId, userId }) : null]);
    await emit({
      userId, agent: approval.agent!, surface: req.surface ?? "system", type: "approval_requested",
      summary: `Asked you to approve ${usd(req.amountCents)}${product ? ` for ${product.title}` : ""}${mandate ? ` on Visa ••${mandate.card.last4}` : ""}`,
      refs: { approvalId: approval._id, productId, mandateId: req.mandateId },
    });
    return approval;
  }
  throw new Error("could not create approval");
}

export async function listApprovals(userId: string, status?: Approval["status"]): Promise<ApprovalView[]> {
  await expireStale(userId);
  const c = await collections();
  const list = await c.approvals.find<ApprovalDoc>({ userId, ...(status && { status }) }).sort({ expiresAt: -1 }).limit(50).toArray();
  const ids = (k: "productId" | "offerId" | "mandateId") => [...new Set(list.map((a) => a[k]).filter((x): x is string => !!x))];
  const [products, offers, mandates, cards] = await Promise.all([
    c.products.find({ _id: { $in: ids("productId") } }, { projection: { embedding: 0 } }).toArray(),
    c.offers.find({ _id: { $in: ids("offerId") } }).toArray(),
    c.mandates.find({ _id: { $in: ids("mandateId") }, userId }).toArray(),
    c.cards.find({ userId }).toArray(),
  ]);
  const by = <T extends { _id: string }>(xs: T[], id?: string) => (id ? xs.find((x) => x._id === id) : undefined);
  return list.map(({ idempotencyKey: _, ...a }) => {
    const product = by(products, a.productId);
    const mandate = by(mandates, a.mandateId);
    const card = product && cards.length ? pickCard(cards, product.category, mandate) : undefined;
    return {
      ...a, product, offer: by(offers, a.offerId), mandate,
      cardLast4: mandate?.card.last4 ?? card?.last4, rewardCents: card && product ? rewardFor(card, product.category, a.amountCents) : undefined,
    };
  });
}

/** Loads the user's pending, unexpired approval or throws 404/409. */
export async function pendingApproval(id: string, userId: string): Promise<ApprovalDoc> {
  const a = await (await collections()).approvals.findOne<ApprovalDoc>({ _id: requireId(id, "approvalId"), userId: requireId(userId, "userId") });
  if (!a) throw new HTTPException(404, { message: `approval ${id} not found` });
  if (a.status !== "pending" || a.expiresAt <= new Date())
    throw new HTTPException(409, { message: `approval ${a.shortCode} is ${a.status === "pending" ? "expired" : a.status}` });
  return a;
}

/** Deny any approval, or approve a non-purchase one (enroll — B acts on the approval_resolved event). */
export async function resolveWithoutPurchase(a: Approval, { decision, channel }: ApprovalDecision): Promise<Approval> {
  const c = await collections();
  const status = decision === "approve" ? "approved" : "denied";
  const now = new Date();
  const updated = await c.approvals.findOneAndUpdate(
    { _id: a._id, userId: a.userId, status: "pending", expiresAt: { $gt: now } },
    { $set: { status, resolvedAt: now, channel } },
    { returnDocument: "after" },
  );
  if (!updated) throw new HTTPException(409, { message: `approval ${a.shortCode} is no longer pending` });
  const product = a.productId ? await c.products.findOne({ _id: a.productId }) : null;
  await emit({
    userId: a.userId, agent: channel === "web" ? "orchestrator" : "messenger", surface: channel, type: "approval_resolved",
    summary: `You ${status === "approved" ? "approved" : "declined"} ${usd(a.amountCents)}${product ? ` for ${product.title}` : ""}`,
    refs: { approvalId: a._id, productId: a.productId, mandateId: a.mandateId },
  });
  return updated;
}
