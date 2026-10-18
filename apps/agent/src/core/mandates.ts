// Owner: A. The ONLY way money moves (DESIGN.md §8.2). Guardrails live here in code, never in prompts.
import { collections, type ClientSession } from "@alfred/shared/db";
import type { Category, Mandate } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { emit } from "./events";
import { usd } from "./util";

export async function authorize(
  mandateId: string,
  amountCents: number,
  merchantId: string,
  category: Category,
  session?: ClientSession,
): Promise<Mandate | null> {
  // A zero/negative/fractional amount would leave the cap untouched or *raise* the remaining headroom.
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  const c = await collections();
  return c.mandates.findOneAndUpdate(
    {
      _id: mandateId,
      status: "active",
      expiresAt: { $gt: new Date() },
      $expr: { $lte: [{ $add: ["$spentCents", amountCents] }, "$capCents"] },
      $or: [{ categories: category }, { merchants: merchantId }],
    },
    { $inc: { spentCents: amountCents } },
    { returnDocument: "after", session },
  );
}

/** Human-readable reason authorize() would decline (for the feed). Read-only. */
export async function whyDeclined(mandateId: string | undefined, amountCents: number, merchantId: string, category: Category): Promise<string> {
  if (!mandateId) return "no mandate";
  const m = await (await collections()).mandates.findOne({ _id: mandateId });
  if (!m) return "no such mandate";
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

export async function revokeMandate(id: string): Promise<Mandate> {
  const c = await collections();
  const m = await c.mandates.findOneAndUpdate({ _id: id, status: "active" }, { $set: { status: "revoked" } }, { returnDocument: "after" });
  if (!m) {
    const existing = await c.mandates.findOne({ _id: id });
    throw new HTTPException(existing ? 409 : 404, { message: existing ? `mandate is already ${existing.status}` : `mandate ${id} not found` });
  }
  await emit({
    userId: m.userId, agent: m.agent, surface: "web", type: "message",
    summary: `Revoked “${m.label}” — ${m.agent} can no longer spend on Visa ••${m.card.last4}`,
    refs: { mandateId: m._id },
  });
  return m;
}
