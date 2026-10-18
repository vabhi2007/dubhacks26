// Owner: C. PRICE_SOURCE=live (SerpAPI → cache) | cache (Mongo) | mock (fixtures).
// live: fresh cached SerpAPI offers (< 24h) → else one SerpAPI search, Haiku-labeled, stored as the cache → on any
// failure, whatever Mongo already has. Seeded offers are never modified; the frozen demo products never go live.
import * as fx from "@alfred/shared/fixtures";
import { currentOffers, LIVE_OFFER_PREFIX, LIVE_OFFER_TTL_MS, Offer, type PriceSource, type Product, type RawOffer } from "@alfred/shared";
import { collections, newId } from "@alfred/shared/db";
import { env } from "../env";
import { LOOKUP_MS, withTimeout } from "./timeout";
import { NEW_PRODUCT_PREFIX, UNIDENTIFIED_ID } from "../vision/resolve";
import { serpApiSource } from "./serpapi";
import { labelOffers } from "./label";
import { dropImplausible } from "./sanity";
import { embedProduct } from "./similar";

export const mockPriceSource: PriceSource = {
  async search() {
    return fx.offers.map(({ seller, priceCents, condition, region, url }): RawOffer => ({ title: fx.product.title, seller, priceCents, condition, region, url }));
  },
};

export const priceSource: PriceSource = env.PRICE_SOURCE === "live" ? serpApiSource : mockPriceSource;

/** DESIGN.md §7: the hero products keep their seeded offers and price history so the demo script holds. */
const FROZEN = new Set(["prd_bambino_plus", "prd_iphone17"]);
const LIVE_PREFIX = LIVE_OFFER_PREFIX; // SerpAPI offers; seeded ones are ofr_*
const LIVE_TTL_MS = LIVE_OFFER_TTL_MS;
const PAUSE_MS = 10 * 60_000;
let livePausedUntil = 0; // set on quota / auth errors so we stop asking SerpAPI for a while

/** Fixture offers exist only for the hero product; anything else has no mock prices. */
const mockOffers = (product: Product): Offer[] => (product._id === fx.product._id ? fx.offers : []);

const validOffers = (rows: unknown[]) =>
  rows.flatMap((r) => {
    const o = Offer.safeParse(r);
    if (!o.success) console.warn(`findOffers: dropping invalid offer ${String((r as { _id?: unknown })._id)}`);
    return o.success ? [o.data] : [];
  });

/** Offers for a product (the orchestrator's entry point; same pricing as /snap). */
export async function findOffers(product: Product): Promise<Offer[]> {
  return (await priceProduct(product)).offers;
}

/**
 * Offers for a resolved product, plus the product itself: a product Claude named that isn't in the catalog yet is
 * saved (source "serpapi") once live prices find it, so later snaps, watches and verdicts can refer to it.
 */
export async function priceProduct(product: Product): Promise<{ product: Product; offers: Offer[] }> {
  if (product._id === UNIDENTIFIED_ID) return { product, offers: [] };
  if (env.PRICE_SOURCE === "live" && canGoLive(product)) {
    try {
      return await liveOffers(product);
    } catch (e) {
      const msg = (e as Error).message;
      if (/run out of searches|invalid api key|unauthorized/i.test(msg)) livePausedUntil = Date.now() + PAUSE_MS;
      console.warn(`findOffers: live prices failed for ${product._id}, using cache:`, msg);
    }
  }
  return { product, offers: await cachedOffers(product) };
}

function canGoLive(p: Product) {
  if (FROZEN.has(p._id)) return false;
  if (!env.SERPAPI_KEY || !env.MONGODB_URI) return false; // no cache → every snap would spend a search
  return Date.now() >= livePausedUntil;
}

/** cache/live fallback: Mongo `offers` (invalid rows dropped); empty or unreachable → mock. */
async function cachedOffers(product: Product): Promise<Offer[]> {
  if (env.PRICE_SOURCE !== "mock" && env.MONGODB_URI) {
    try {
      const rows = await withTimeout(collections().then((c) => c.offers.find({ productId: product._id }, { timeoutMS: LOOKUP_MS }).toArray()), undefined, "offer lookup");
      // Same rule as every other reader (verdicts, Watcher, product page): fresh live offers supersede seeded ones.
      const cached = currentOffers(validOffers(rows));
      if (cached.length) return cached;
      console.warn(`findOffers: no cached offers for ${product._id}, using mock`);
    } catch (e) {
      console.warn("findOffers: db lookup failed, using mock:", (e as Error).message);
    }
  }
  return mockOffers(product);
}

async function liveOffers(input: Product): Promise<{ product: Product; offers: Offer[] }> {
  const c = await collections();
  // A product Claude named may have been saved by an earlier snap: same canonicalKey (unique index) → same product.
  const saved = input._id.startsWith(NEW_PRODUCT_PREFIX)
    ? await c.products.findOne({ canonicalKey: input.canonicalKey }, { projection: { embedding: 0 }, timeoutMS: LOOKUP_MS })
    : null;
  let product = saved ?? input;

  const fresh = validOffers(
    await c.offers
      .find({ productId: product._id, _id: { $regex: `^${LIVE_PREFIX}` }, fetchedAt: { $gte: new Date(Date.now() - LIVE_TTL_MS) } }, { timeoutMS: LOOKUP_MS })
      .toArray(),
  );
  if (fresh.length) {
    console.log(`findOffers: ${fresh.length} live offers for ${product._id} from cache`);
    return { product, offers: fresh };
  }

  const raw = await serpApiSource.search(searchQuery(product));
  const { labels, typicalCents } = await labelOffers(product, raw);
  const sane = dropImplausible(product, raw, labels, typicalCents);
  const kept = sane.kept.map((i) => ({ r: raw[i]!, l: labels[i]! }));
  const different = labels.filter((l) => l.matched === "different").length;
  console.log(`findOffers: ${raw.length} results → ${kept.length} kept (${kept.filter((k) => k.l.matched === "exact").length} exact), ${different} different, ${sane.dropped.length} implausible · reference ${sane.ref ? `$${(sane.ref.cents / 100).toFixed(2)} (${sane.ref.basis})` : "none"}`);
  for (const d of sane.dropped) console.log(`  dropped $${(d.r.priceCents / 100).toFixed(2)} ${d.r.seller}: ${d.reason}`);
  // Nothing usable from this search: a catalog product keeps its stored offers (what the Watcher and product page see).
  if (!kept.length) return { product, offers: product._id.startsWith(NEW_PRODUCT_PREFIX) ? [] : await cachedOffers(product) };

  if (product._id.startsWith(NEW_PRODUCT_PREFIX)) {
    const { _id: _, ...fields } = product;
    const imageUrl = kept.find((k) => k.l.matched === "exact")?.r.thumbnail ?? kept[0]!.r.thumbnail;
    const doc = await c.products.findOneAndUpdate(
      { canonicalKey: product.canonicalKey },
      { $setOnInsert: { ...fields, _id: newId("prd"), source: "serpapi", ...(imageUrl && { imageUrl }) } },
      { upsert: true, returnDocument: "after", projection: { embedding: 0 } },
    );
    if (doc) product = doc;
    console.log(`findOffers: saved new product ${product._id} "${product.title}"`);
    if (!saved) void embedProduct(product); // in the background: only similar-item search needs it
  }

  const now = new Date();
  const offers: Offer[] = kept.map(({ r, l }) => ({
    _id: newId(LIVE_PREFIX.slice(0, -1)),
    productId: product._id,
    seller: r.seller,
    priceCents: r.priceCents,
    condition: l.condition,
    region: l.region.toUpperCase(),
    matched: l.matched,
    fetchedAt: now,
    ...(r.url && { url: r.url }),
  }));
  // Replace this product's previous SerpAPI offers; seeded ofr_* offers stay. History lets Worth-It see trends later.
  await c.offers.deleteMany({ productId: product._id, _id: { $regex: `^${LIVE_PREFIX}` } });
  await c.offers.insertMany(offers);
  const history = offers.filter((o) => o.matched === "exact" && o.condition === "new").map((o) => ({ ts: now, meta: { productId: product._id, seller: o.seller }, priceCents: o.priceCents }));
  if (history.length) await c.priceHistory.insertMany(history);
  return { product, offers };
}

/** Title plus the model code when the title doesn't already carry it (Google Shopping matches codes well). */
function searchQuery(p: Product) {
  return p.model && !p.title.toLowerCase().includes(p.model.toLowerCase()) ? `${p.title} ${p.model}` : p.title;
}

const tier = (o: Offer) => (o.matched === "exact" && o.condition === "new" && o.region === "US" ? 0 : o.condition === "new" ? 1 : 2);

/** Best new US exact match first (cheapest within group), then other new, then used/refurb. */
export function rankOffers(offers: Offer[]): Offer[] {
  return offers.filter((o) => o.matched !== "different").sort((a, b) => tier(a) - tier(b) || a.priceCents - b.priceCents);
}

export { getVerdict } from "./verdict";
export { findSimilar } from "./similar";
