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
