// Owner: C. PRICE_SOURCE=live (SerpAPI → cache) | cache (Mongo) | mock (fixtures).
import * as fx from "@alfred/shared/fixtures";
import { Offer, type PriceSource, type Product, type RawOffer } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { env } from "../env";
import { LOOKUP_MS, withTimeout } from "./timeout";
import { UNIDENTIFIED_ID } from "../vision/resolve";

export const mockPriceSource: PriceSource = {
  async search() {
    return fx.offers.map(({ seller, priceCents, condition, region, url }): RawOffer => ({ title: fx.product.title, seller, priceCents, condition, region, url }));
  },
};

// TODO(C, MVP-1): SerpAPI google_shopping + Haiku labeling (exact/variant/different, new/used/refurb, region).
export const priceSource: PriceSource = mockPriceSource;

/** Fixture offers exist only for the hero product; anything else has no mock prices. */
const mockOffers = (product: Product): Offer[] => (product._id === fx.product._id ? fx.offers : []);

/** Offers for a resolved product. cache/live read Mongo `offers` (invalid rows dropped); empty or unreachable → mock. */
export async function findOffers(product: Product): Promise<Offer[]> {
  if (product._id === UNIDENTIFIED_ID) return [];
  if (env.PRICE_SOURCE !== "mock" && env.MONGODB_URI) {
    try {
      const rows = await withTimeout(collections().then((c) => c.offers.find({ productId: product._id }, { timeoutMS: LOOKUP_MS }).toArray()), undefined, "offer lookup");
      const cached = rows.flatMap((r) => {
        const o = Offer.safeParse(r);
        if (!o.success) console.warn(`findOffers: dropping invalid offer ${String(r._id)}`);
        return o.success ? [o.data] : [];
      });
      if (cached.length) return cached;
      console.warn(`findOffers: no cached offers for ${product._id}, using mock`);
    } catch (e) {
      console.warn("findOffers: db lookup failed, using mock:", (e as Error).message);
    }
  }
  return mockOffers(product);
}

const tier = (o: Offer) => (o.matched === "exact" && o.condition === "new" && o.region === "US" ? 0 : o.condition === "new" ? 1 : 2);

/** Best new US exact match first (cheapest within group), then other new, then used/refurb. */
export function rankOffers(offers: Offer[]): Offer[] {
  return offers.filter((o) => o.matched !== "different").sort((a, b) => tier(a) - tier(b) || a.priceCents - b.priceCents);
}

export { getVerdict } from "./verdict";
