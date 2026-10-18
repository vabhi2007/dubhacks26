// Owner: A. The ONLY way money moves (DESIGN.md §8.2). Guardrails live here in code, never in prompts.
// Mandates are scoped per user and per agent (DESIGN.md F3): an agent can only spend a mandate issued to it.
import { collections, type ClientSession } from "@alfred/shared/db";
import type { AgentName, Category, Mandate } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { emit } from "./events";
import { requireId, usd } from "./util";

export type MandateScope = { userId: string; agent: AgentName };

export async function authorize(
  mandateId: string,
  amountCents: number,
  merchantId: string,
  category: Category,
  scope: MandateScope & { session?: ClientSession },
): Promise<Mandate | null> {
  // A zero/negative/fractional amount would leave the cap untouched or *raise* the remaining headroom.
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  const c = await collections();
  return c.mandates.findOneAndUpdate(
    {
      _id: requireId(mandateId, "mandateId"),
      userId: requireId(scope.userId, "userId"),
      agent: scope.agent,
      status: "active",
      expiresAt: { $gt: new Date() },
      $expr: { $lte: [{ $add: ["$spentCents", amountCents] }, "$capCents"] },
      $or: [{ categories: category }, { merchants: merchantId }],
    },
    { $inc: { spentCents: amountCents } },
    { returnDocument: "after", session: scope.session },
  );
}

/** Human-readable reason authorize() would decline (for the feed). Read-only. */
export async function whyDeclined(mandateId: string | undefined, amountCents: number, merchantId: string, category: Category, scope: MandateScope): Promise<string> {
  if (!mandateId) return "no mandate";
  const m = await (await collections()).mandates.findOne({ _id: mandateId, userId: scope.userId });
  if (!m) return "no such mandate";
  if (m.agent !== scope.agent) return `it's issued to ${m.agent}, not ${scope.agent}`;
  if (m.status !== "active") return `mandate is ${m.status}`;
  if (m.expiresAt <= new Date()) return "mandate expired";
  if (!m.categories.includes(category) && !m.merchants.includes(merchantId)) return `${category} isn't covered`;
  if (m.spentCents + amountCents > m.capCents) return `only ${usd(m.capCents - m.spentCents)} left of ${usd(m.capCents)}`;
  return "invalid amount";
}

/** Expiry is enforced in query filters (DESIGN.md §8.1); this just keeps `status` honest for readers. */
async function expireStale(userId: string) {
  const c = await collections();
  await c.mandates.updateMany({ userId, status: "active", expiresAt: { $lte: new Date() } }, { $set: { status: "expired" } });
}

export async function listMandates(userId: string): Promise<Mandate[]> {
  await expireStale(userId);
  const c = await collections();
  return c.mandates.find({ userId }).sort({ status: 1, expiresAt: 1 }).toArray();
}

/** Revoking also cancels (expires) the mandate's pending approvals — revoke means "stop this agent's spending", asks in flight included. */
export async function revokeMandate(id: string, userId: string): Promise<Mandate> {
  const c = await collections();
  const m = await c.mandates.findOneAndUpdate({ _id: requireId(id, "mandateId"), userId, status: "active" }, { $set: { status: "revoked" } }, { returnDocument: "after" });
  if (!m) {
    const existing = await c.mandates.findOne({ _id: id, userId });
    throw new HTTPException(existing ? 409 : 404, { message: existing ? `mandate is already ${existing.status}` : `mandate ${id} not found` });
  }
  const { modifiedCount } = await c.approvals.updateMany({ userId, mandateId: m._id, status: "pending" }, { $set: { status: "expired" } });
  await emit({
    userId: m.userId, agent: m.agent, surface: "web", type: "message",
    summary: `Revoked “${m.label}” — ${m.agent} can no longer spend on Visa ••${m.card.last4}${modifiedCount ? ` (cancelled ${modifiedCount} pending approval${modifiedCount > 1 ? "s" : ""})` : ""}`,
    refs: { mandateId: m._id },
  });
  return m;
}
