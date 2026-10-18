// Owner: A. The ONLY way money moves (DESIGN.md §8.2). Guardrails live here in code, never in prompts.
// Mandates are scoped per user and per agent (DESIGN.md F3): an agent can only spend a mandate issued to it.
import { collections, newId, type ClientSession } from "@alfred/shared/db";
import type { AgentName, Category, Mandate, MandateCreate } from "@alfred/shared";
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

const DAY = 86_400_000;
const AGENT_NAME: Partial<Record<AgentName, string>> = { watcher: "the Watcher", orchestrator: "Alfred", smart_pay: "Smart Pay" };

/** A fresh mock virtual Visa for one mandate: last4 unique among the user's mandates, opaque token. */
async function issueVirtualCard(userId: string): Promise<Mandate["card"]> {
  const c = await collections();
  const taken = new Set((await c.mandates.find({ userId }, { projection: { "card.last4": 1 } }).toArray()).map((m) => m.card.last4));
  let last4 = "";
  for (let i = 0; i < 50 && (!last4 || taken.has(last4)); i++) last4 = String(1000 + Math.floor(Math.random() * 9000));
  return { last4, token: `tok_mock_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}` };
}

/** Issue a new scoped mandate (DESIGN.md F3). Spending still goes only through authorize(); the confirm-above threshold still applies. */
export async function createMandate(userId: string, input: MandateCreate): Promise<Mandate> {
  const c = await collections();
  const label = input.label.trim();
  if (await c.mandates.findOne({ userId, status: "active", label })) throw new HTTPException(409, { message: `an active mandate named “${label}” already exists` });
  const m: Mandate = {
    _id: newId("mnd"),
    userId,
    agent: input.agent,
    label,
    capCents: input.capCents,
    spentCents: 0,
    categories: [...new Set(input.categories)],
    merchants: [...new Set(input.merchants)],
    expiresAt: new Date(Date.now() + input.days * DAY),
    status: "active",
    card: await issueVirtualCard(userId),
  };
  await c.mandates.insertOne(m);
  await emit({
    userId, agent: m.agent, surface: "web", type: "message",
    summary: `New mandate “${m.label}” — ${AGENT_NAME[m.agent] ?? m.agent} can spend up to ${usd(m.capCents)} on ${m.categories.join(", ")} for ${input.days} days on Visa ••${m.card.last4}`,
    refs: { mandateId: m._id },
  });
  return m;
}
