// Owner: A. Demo control (DESIGN.md §3 "Demo control", §8.3 /admin/*). Hidden from the main nav; announce resets first.
import { collections } from "@alfred/shared/db";
import { seedDemo } from "@alfred/shared/seed";
import type { AgentEvent, Offer } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { emit } from "./events";
import { usd } from "./util";

/** Re-prices the product's cheapest new US exact offer and records it in price_history. Emits `price_drop` only on a drop. */
export async function priceDrop(userId: string, productId: string, newPriceCents: number): Promise<{ offer: Offer; previousPriceCents: number; event?: AgentEvent }> {
  if (newPriceCents <= 0) throw new HTTPException(400, { message: "newPriceCents must be positive" });
  const c = await collections();
  const [product, best] = await Promise.all([
    c.products.findOne({ _id: productId }, { projection: { embedding: 0 } }),
    c.offers.find({ productId, condition: "new", matched: "exact", region: "US" }).sort({ priceCents: 1 }).limit(1).next(),
  ]);
  if (!product || !best) throw new HTTPException(404, { message: `no new US offer for ${productId}` });

  const now = new Date();
  await Promise.all([
    c.offers.updateOne({ _id: best._id }, { $set: { priceCents: newPriceCents, fetchedAt: now } }),
    c.priceHistory.insertOne({ ts: now, meta: { productId, seller: best.seller }, priceCents: newPriceCents }),
  ]);
  const offer = { ...best, priceCents: newPriceCents, fetchedAt: now };
  if (newPriceCents >= best.priceCents) return { offer, previousPriceCents: best.priceCents };

  const event = await emit({
    userId, agent: "watcher", surface: "system", type: "price_drop",
    summary: `${product.title} dropped to ${usd(newPriceCents)} at ${best.seller} (was ${usd(best.priceCents)})`,
    refs: { productId },
  });
  return { offer, previousPriceCents: best.priceCents, event };
}

export const resetDemo = () => seedDemo();

const DAY = 86_400_000;
const FINANCING_MONTHS = 24; // same carrier term Timekeeper assumes

/**
 * "Advance time" for the demo without a global clock: shift every stored timestamp back by `days`, which is what the
 * world looks like `days` later to every reader that compares against `new Date()`. Then refill the gap at the recent
 * end so spend and price history stay continuous: transactions repeat the previous `days` (same cadence), and each
 * price series holds its last price. Approvals past their expiry become expired, and financing pays down.
 */
export async function advanceTime(userId: string, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new HTTPException(400, { message: "days must be 1–90" });
  const c = await collections();
  const ms = days * DAY;
  const now = Date.now();
  const back = (f: string) => ({ [f]: { $cond: [{ $eq: [{ $type: `$${f}` }, "date"] }, { $subtract: [`$${f}`, ms] }, `$${f}`] } });

  // Regular collections: pipeline updates, only where the field is a date.
  const shifted: Record<string, number> = {};
  const shift = async (name: keyof typeof c, fields: string[]) => {
    type PipelineUpdatable = { updateMany(filter: object, update: object[]): Promise<{ modifiedCount: number }> };
    const r = await (c[name] as unknown as PipelineUpdatable).updateMany({}, [{ $set: Object.assign({}, ...fields.map(back)) }]);
    shifted[name] = r.modifiedCount;
  };

  // Devices first: pay financing down by the months that pass, using Timekeeper's model (remaining / months left).
  for (const d of await c.devices.find().toArray()) {
    const ageMonths = (now - d.purchasedAt.getTime()) / (30.44 * DAY);
    const monthsLeft = Math.max(1, FINANCING_MONTHS - ageMonths);
    const paid = Math.round((d.financingRemainingCents / monthsLeft) * (days / 30.44));
    await c.devices.updateOne({ _id: d._id }, { $set: { purchasedAt: new Date(d.purchasedAt.getTime() - ms), financingRemainingCents: Math.max(0, d.financingRemainingCents - paid) } });
  }
  await Promise.all([
    shift("orders", ["ts"]),
    shift("verdicts", ["createdAt"]),
    shift("agentEvents", ["ts"]),
    shift("approvals", ["expiresAt", "resolvedAt", "createdAt"]),
    shift("mandates", ["expiresAt"]),
    shift("cardOffers", ["expiresAt"]),
    shift("offers", ["fetchedAt"]),
  ]);
  await c.conversations.updateMany({}, [
    { $set: { messages: { $map: { input: "$messages", as: "m", in: { $mergeObjects: ["$$m", { ts: { $subtract: ["$$m.ts", ms] } }] } } } } },
  ]);

  // Time series: rewrite shifted (ts is the time field), then refill the last `days`.
  const tx = await c.transactions.find({}, { projection: { _id: 0 } }).toArray();
  const txShifted = tx.map((t) => ({ ...t, ts: new Date(t.ts.getTime() - ms) }));
  const refillTx = txShifted.filter((t) => t.ts.getTime() > now - 2 * ms).map((t) => ({ ...t, ts: new Date(t.ts.getTime() + ms) }));
  await c.transactions.deleteMany({});
  if (txShifted.length + refillTx.length) await c.transactions.insertMany([...txShifted, ...refillTx], { ordered: false });

  const ph = await c.priceHistory.find({}, { projection: { _id: 0 } }).toArray();
  const phShifted = ph.map((p) => ({ ...p, ts: new Date(p.ts.getTime() - ms) }));
  const last = new Map<string, (typeof phShifted)[number]>();
  for (const p of phShifted) {
    const k = `${p.meta.productId}|${p.meta.seller}`;
    if (!last.has(k) || last.get(k)!.ts < p.ts) last.set(k, p);
  }
  const refillPh = [...last.values()].flatMap((p) =>
    Array.from({ length: days }, (_, i) => ({ ...p, ts: new Date(p.ts.getTime() + (i + 1) * DAY) })).filter((q) => q.ts.getTime() <= now),
  );
  await c.priceHistory.deleteMany({});
  if (phShifted.length + refillPh.length) await c.priceHistory.insertMany([...phShifted, ...refillPh], { ordered: false });

  const expired = await c.approvals.updateMany({ status: "pending", expiresAt: { $lte: new Date() } }, { $set: { status: "expired" } });
  const counts = { ...shifted, transactions: tx.length, transactionsRefilled: refillTx.length, priceHistory: ph.length, pricePointsRefilled: refillPh.length, approvalsExpired: expired.modifiedCount };

  // Change streams only see inserts: this tells connected surfaces to refetch.
  await emit({
    userId, agent: "orchestrator", surface: "system", type: "message",
    summary: `Fast-forwarded ${days} day${days === 1 ? "" : "s"}${expired.modifiedCount ? ` — ${expired.modifiedCount} approval${expired.modifiedCount === 1 ? "" : "s"} expired` : ""}`,
    refs: {},
  });
  return counts;
}
