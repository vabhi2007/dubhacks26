// Owner: C. SerpAPI Google Shopping (gl=us) → RawOffer[]. The free plan is ~250 searches/month, so this is only reached
// on a cache miss with PRICE_SOURCE=live (deal/index.ts); never call it from loops or tests.
import type { PriceSource, RawOffer } from "@alfred/shared";
import { env } from "../env";

const TIMEOUT_MS = 6_000;
const MAX_RESULTS = 25;

type ShoppingResult = {
  title?: string;
  source?: string;
  extracted_price?: number;
  product_link?: string;
  link?: string;
  thumbnail?: string;
  second_hand_condition?: string;
};

// Identical searches in flight share one request (e.g. two snaps of the same product a second apart).
const inflight = new Map<string, Promise<RawOffer[]>>();

export const serpApiSource: PriceSource = {
  search(query) {
    const key = query.trim().toLowerCase();
    const running = inflight.get(key);
    if (running) return running;
    const p = searchOnce(query).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  },
};

async function searchOnce(query: string): Promise<RawOffer[]> {
  if (!env.SERPAPI_KEY) throw new Error("SERPAPI_KEY not set");
  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries({ engine: "google_shopping", q: query, gl: "us", hl: "en", api_key: env.SERPAPI_KEY })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as { shopping_results?: ShoppingResult[]; error?: string } | null;
  // Quota errors come back as { error: "Your account has run out of searches." }; "hasn't returned any results" is a real empty.
  if (body?.error && !/hasn't returned any results/i.test(body.error)) throw new Error(`serpapi: ${body.error}`);
  if (!res.ok && !body?.error) throw new Error(`serpapi HTTP ${res.status}`);
  console.log(`serpapi: 1 search · "${query}" · ${body?.shopping_results?.length ?? 0} results`);
  return toRawOffers(body?.shopping_results ?? []);
}

export const toRawOffers = (results: ShoppingResult[]) => results.slice(0, MAX_RESULTS).flatMap(toRawOffer);

/** Condition and region here are first guesses from SerpAPI's fields; the Haiku labeler (label.ts) has the final say. */
function toRawOffer(r: ShoppingResult): RawOffer[] {
  const priceCents = Math.round((r.extracted_price ?? 0) * 100);
  if (!r.title || !r.source || !(priceCents > 0)) return [];
  const used = /pre-owned|used/i.test(r.second_hand_condition ?? "");
  const refurb = /refurb/i.test(r.second_hand_condition ?? "");
  return [{
    title: r.title,
    seller: r.source,
    priceCents,
    condition: refurb ? "refurb" : used ? "used" : "new",
    region: "US",
    ...((r.product_link ?? r.link) && { url: r.product_link ?? r.link }),
    ...(r.thumbnail && { thumbnail: r.thumbnail }),
  }];
}
