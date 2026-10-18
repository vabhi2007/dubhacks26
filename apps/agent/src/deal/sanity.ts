// Owner: C. Drop listings that can't be real offers before one becomes the "best price". Bait stores list e.g. a $300
// grinder at $73 under a matching title, and Haiku labels them "exact new" because the title is right.
// Reference price: median exact-new US price at major retailers → else the labeler's typical-retail estimate when most
// listings look like bait → else the median exact-new US price. Then: flagged sellers out, new < 70% of it out,
// used/refurb < 30% out, anything > 3× out.
import type { Product, RawOffer } from "@alfred/shared";
import type { Label } from "./label";

const NEW_FLOOR = 0.7;
const USED_FLOOR = 0.3;
const CEILING = 3;

// Retailers whose listings are the seller's own stock at real prices (not marketplace third parties).
const MAJOR = new Set([
  "amazon", "amazon.com", "target", "walmart", "walmart.com", "best buy", "costco", "home depot", "the home depot", "lowe's",
  "macy's", "kohl's", "williams sonoma", "williams-sonoma", "sur la table", "crate & barrel", "b&h photo-video-audio", "b&h photo",
  "adorama", "apple", "samsung", "google store", "dyson", "breville", "newegg", "staples", "rei", "nordstrom", "wayfair", "bloomingdale's",
]);

const norm = (s: string) => s.toLowerCase().replace(/\.com$/, "").trim();
const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export type Dropped = { r: RawOffer; reason: string };

export function referencePrice(product: Product, raw: RawOffer[], labels: Label[], typicalCents?: number) {
  const exactNewUS = raw.filter((_, i) => labels[i]!.matched === "exact" && labels[i]!.condition === "new" && labels[i]!.region.toUpperCase() === "US" && !labels[i]!.suspicious);
  const isMajor = (seller: string) => MAJOR.has(norm(seller)) || (!!product.brand && norm(seller) === norm(product.brand));
  const major = median(exactNewUS.filter((r) => isMajor(r.seller)).map((r) => r.priceCents));
  if (major) return { cents: major, basis: "major retailers" as const };
  const all = median(exactNewUS.map((r) => r.priceCents));
  if (typicalCents && (!all || all < typicalCents * 0.6)) return { cents: typicalCents, basis: "typical retail estimate" as const };
  if (all) return { cents: all, basis: "median listing" as const };
  return typicalCents ? { cents: typicalCents, basis: "typical retail estimate" as const } : undefined;
}

/** Keep listings that could plausibly be real offers for this product; say why the rest were dropped. */
export function dropImplausible(product: Product, raw: RawOffer[], labels: Label[], typicalCents?: number) {
  const ref = referencePrice(product, raw, labels, typicalCents);
  const kept: number[] = [];
  const dropped: Dropped[] = [];
  raw.forEach((r, i) => {
    const l = labels[i]!;
    if (l.matched === "different") return;
    const reason = l.suspicious
      ? "seller looks like bait"
      : !ref
        ? undefined
        : r.priceCents > ref.cents * CEILING
          ? `over ${CEILING}× the ${ref.basis} price`
          : l.condition === "new" && r.priceCents < ref.cents * NEW_FLOOR
            ? `new at under ${NEW_FLOOR * 100}% of the ${ref.basis} price`
            : l.condition !== "new" && r.priceCents < ref.cents * USED_FLOOR
              ? `${l.condition} at under ${USED_FLOOR * 100}% of the ${ref.basis} price`
              : undefined;
    if (reason) dropped.push({ r, reason });
    else kept.push(i);
  });
  return { kept, dropped, ref };
}
