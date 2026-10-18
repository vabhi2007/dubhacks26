// Owner: A. Human-in-the-loop requests. Inserting a pending approval triggers the Messenger (changeStreams.ts).
// Approving a purchase goes through purchase.ts (resolveApproval) so money still only moves via authorize().
import { collections, newId } from "@alfred/shared/db";
import type { AgentName, Approval, ApprovalDecision, Mandate, Offer, Product, Surface } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { emit } from "./events";
import { isDuplicateKey, usd } from "./util";

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
  agent?: AgentName;
  surface?: Surface;
};

/** Approval plus what a card needs to render it. */
export type ApprovalView = Approval & { product?: Product; offer?: Offer; mandate?: Mandate };

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

/** Idempotent: an identical pending request (same user, product, offer, amount) returns the existing approval. */
export async function requestApproval(req: ApprovalRequest): Promise<Approval> {
  const c = await collections();
  await expireStale(req.userId);
  const key = { userId: req.userId, kind: "purchase" as const, status: "pending" as const, productId: req.productId, offerId: req.offerId, amountCents: req.amountCents };
  const existing = await c.approvals.findOne(key);
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt++) {
    const approval: Approval = { _id: newId("apr"), ...key, mandateId: req.mandateId, channel: req.channel ?? "imessage", shortCode: await freeShortCode(req.userId), expiresAt: new Date(Date.now() + TTL_MS) };
    try {
      await c.approvals.insertOne(approval);
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      const dup = await c.approvals.findOne(key); // another agent process won the race
      if (dup) return dup;
      continue; // short-code clash — retry
    }
    const [product, mandate] = await Promise.all([c.products.findOne({ _id: req.productId }), req.mandateId ? c.mandates.findOne({ _id: req.mandateId }) : null]);
    await emit({
      userId: req.userId, agent: req.agent ?? "orchestrator", surface: req.surface ?? "system", type: "approval_requested",
      summary: `Asked you to approve ${usd(req.amountCents)}${product ? ` for ${product.title}` : ""}${mandate ? ` on Visa ••${mandate.card.last4}` : ""}`,
      refs: { approvalId: approval._id, productId: req.productId, mandateId: req.mandateId },
    });
    return approval;
  }
  throw new Error("could not create approval");
}

export async function listApprovals(userId: string, status?: Approval["status"]): Promise<ApprovalView[]> {
  await expireStale(userId);
  const c = await collections();
  const approvals = await c.approvals.find({ userId, ...(status && { status }) }).sort({ expiresAt: -1 }).limit(50).toArray();
  const ids = (k: "productId" | "offerId" | "mandateId") => [...new Set(approvals.map((a) => a[k]).filter((x): x is string => !!x))];
  const [products, offers, mandates] = await Promise.all([
    c.products.find({ _id: { $in: ids("productId") } }, { projection: { embedding: 0 } }).toArray(),
    c.offers.find({ _id: { $in: ids("offerId") } }).toArray(),
    c.mandates.find({ _id: { $in: ids("mandateId") } }).toArray(),
  ]);
  const by = <T extends { _id: string }>(xs: T[], id?: string) => xs.find((x) => x._id === id);
  return approvals.map((a) => ({ ...a, product: by(products, a.productId), offer: by(offers, a.offerId), mandate: by(mandates, a.mandateId) }));
}

/** Loads a pending, unexpired approval or throws 404/409. */
export async function pendingApproval(id: string): Promise<Approval> {
  const a = await (await collections()).approvals.findOne({ _id: id });
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
    { _id: a._id, status: "pending", expiresAt: { $gt: now } },
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
