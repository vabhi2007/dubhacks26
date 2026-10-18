// Owner: C. PRICE_SOURCE=live (SerpAPI → cache) | cache (Mongo) | mock (fixtures).
import * as fx from "@alfred/shared/fixtures";
import type { Offer, PriceSource, Product, RawOffer } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { env } from "../env";

export const mockPriceSource: PriceSource = {
  async search() {
    return fx.offers.map(({ seller, priceCents, condition, region, url }): RawOffer => ({ title: fx.product.title, seller, priceCents, condition, region, url }));
  },
};

// TODO(C, MVP-1): SerpAPI google_shopping + Haiku labeling (exact/variant/different, new/used/refurb, region).
export const priceSource: PriceSource = mockPriceSource;

/** Offers for a resolved product. cache/live read Mongo `offers`; empty → mock so the loop never dead-ends. */
export async function findOffers(product: Product): Promise<Offer[]> {
  if (env.PRICE_SOURCE !== "mock" && env.MONGODB_URI) {
    try {
      const c = await collections();
      const cached = await c.offers.find({ productId: product._id }).toArray();
      if (cached.length) return cached;
      console.warn(`findOffers: no cached offers for ${product._id}, using mock`);
    } catch (e) {
      console.warn("findOffers: db lookup failed, using mock:", (e as Error).message);
    }
  }
  return fx.offers.map((o) => ({ ...o, productId: product._id }));
}

const tier = (o: Offer) => (o.matched === "exact" && o.condition === "new" && o.region === "US" ? 0 : o.condition === "new" ? 1 : 2);

/** Best new US exact match first (cheapest within group), then other new, then used/refurb. */
export function rankOffers(offers: Offer[]): Offer[] {
  return offers.filter((o) => o.matched !== "different").sort((a, b) => tier(a) - tier(b) || a.priceCents - b.priceCents);
}

export { getVerdict } from "./verdict";
