// Owner: C. PRICE_SOURCE=live (SerpAPI → cache) | cache (Mongo) | mock (fixtures).
import type { PriceSource } from "@alfred/shared";

export const priceSource: PriceSource = {
  async search() {
    // TODO(C): SerpAPI google_shopping + Haiku labeling (exact/variant/different, new/used/refurb, region).
    return [];
  },
};
