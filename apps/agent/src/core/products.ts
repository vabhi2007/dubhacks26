// Owner: A. GET /products/:id — everything a product page needs in one call (DESIGN.md §8.3).
import { collections } from "@alfred/shared/db";
import { currentOffers, type Offer, type Product, type Verdict, type WishlistItem } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { requireId } from "./util";

const DAY = 86_400_000;
const HISTORY_DAYS = 90;

export type BreakEven = { priceCents: number; monthlySavingsCents: number; months: { month: number; cumulativeSavingsCents: number }[] };
export type ProductDetail = {
  product: Product;
  offers: Offer[]; // ranked
  priceHistory: { ts: Date; priceCents: number; seller: string }[]; // last 90 days, new + exact-match sellers, oldest first
  latestVerdict: Verdict | null;
  watch: WishlistItem | null;
  breakEven: BreakEven | null;
};

// Same rule as C's deal ranking: best new US exact match first (cheapest within each group), then other new, then
// used/refurb; listings for a different product are dropped.
const tier = (o: Offer) => (o.matched === "exact" && o.condition === "new" && o.region === "US" ? 0 : o.condition === "new" ? 1 : 2);
export const rankOffers = (offers: Offer[]) => offers.filter((o) => o.matched !== "different").sort((a, b) => tier(a) - tier(b) || a.priceCents - b.priceCents);

/**
 * Cumulative savings per month at the verdict's related monthly spend (12-mo related spend ÷ 12 — the same basis as the
 * verdict's paybackMonths), from month 0 to a little past break-even (6–24 months). Null without related spend.
 */
export function breakEvenFrom(verdict: Verdict | null): BreakEven | null {
  const related = verdict?.math.relatedSpend12moCents;
  const priceCents = verdict?.math.priceCents;
  if (!related || related <= 0 || !priceCents || priceCents <= 0) return null;
  const monthlySavingsCents = Math.round(related / 12);
  const horizon = Math.min(24, Math.max(6, Math.ceil(priceCents / monthlySavingsCents) + 2));
  return {
    priceCents,
    monthlySavingsCents,
    months: Array.from({ length: horizon + 1 }, (_, month) => ({ month, cumulativeSavingsCents: monthlySavingsCents * month })),
  };
}

export async function getProductDetail(productId: string, userId: string): Promise<ProductDetail> {
  const c = await collections();
  const product = await c.products.findOne({ _id: requireId(productId, "productId") }, { projection: { embedding: 0 } });
  if (!product) throw new HTTPException(404, { message: `product ${productId} not found` });
  // Current offers only (fresh live supersedes seeded), so this page shows the price the verdict and Watcher use.
  const offers = rankOffers(currentOffers(await c.offers.find({ productId }).toArray()));
  const sellers = [...new Set(offers.filter((o) => o.condition === "new" && o.matched === "exact").map((o) => o.seller))];
  const [history, latestVerdict, watch] = await Promise.all([
    sellers.length
      ? c.priceHistory
          .find({ "meta.productId": productId, "meta.seller": { $in: sellers }, ts: { $gte: new Date(Date.now() - HISTORY_DAYS * DAY) } }, { projection: { _id: 0 } })
          .sort({ ts: 1 })
          .toArray()
      : [],
    c.verdicts.find({ userId, productId }).sort({ createdAt: -1 }).limit(1).next(),
    c.wishlist.find({ userId, productId, status: { $in: ["watching", "triggered"] } }).sort({ status: -1 }).limit(1).next(), // watching before triggered
  ]);
  return {
    product,
    offers,
    priceHistory: history.map((p) => ({ ts: p.ts, priceCents: p.priceCents, seller: p.meta.seller })),
    latestVerdict,
    watch,
    breakEven: breakEvenFrom(latestVerdict),
  };
}
