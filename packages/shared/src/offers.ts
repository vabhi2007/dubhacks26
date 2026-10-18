// Which stored offers are "the price right now" — one rule for every reader (verdicts, the Watcher, the product page,
// /admin/price-drop), so a product never has two prices at once. Pure; no DB access.
//
// With PRICE_SOURCE=live, the deal agent (C) stores SerpAPI offers with `_id` prefix LIVE_OFFER_PREFIX next to the
// seeded catalog's `ofr_*` offers (which it never modifies). Fresh live offers ARE the market: they supersede seeded
// and stale ones. Without fresh live offers, every stored offer counts (mock / cache mode, the frozen demo products).
import type { Offer } from "./schemas";

export const LIVE_OFFER_PREFIX = "ofs_";
export const LIVE_OFFER_TTL_MS = 24 * 60 * 60_000;

export const isLiveOffer = (o: Pick<Offer, "_id">) => o._id.startsWith(LIVE_OFFER_PREFIX);

/** The offers that define today's price for one product (see header). */
export function currentOffers<T extends Pick<Offer, "_id" | "fetchedAt">>(offers: T[], now = Date.now()): T[] {
  const fresh = offers.filter((o) => isLiveOffer(o) && new Date(o.fetchedAt).getTime() >= now - LIVE_OFFER_TTL_MS);
  return fresh.length ? fresh : offers;
}
