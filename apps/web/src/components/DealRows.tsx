// DealRows — one row per kind of deal (new, refurbished, used, other versions) with its best price and where to get it.
// Plain rows, no chart: the question is "what are my options and what do they cost?". The verdict's pick is in accent.
// DESIGN.md §6: tokens only, .num for money. Used in verdict details and on the product page.
import type { Offer } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "@alfred/ui";

const KINDS: { key: string; label: string; match: (o: Offer) => boolean }[] = [
  { key: "new", label: "New", match: (o) => o.matched === "exact" && o.condition === "new" },
  { key: "refurb", label: "Refurbished", match: (o) => o.matched === "exact" && o.condition === "refurb" },
  { key: "used", label: "Used", match: (o) => o.matched === "exact" && o.condition === "used" },
  // Same product line, different configuration (bundle, storage size, regional twin) — DESIGN.md deal labeling.
  { key: "variant", label: "Other versions", match: (o) => o.matched === "variant" },
];

export function DealRows({ offers, bestOfferId }: { offers: Offer[]; bestOfferId?: string }) {
  const rows = KINDS.flatMap((k) => {
    const all = offers.filter(k.match).sort((a, b) => a.priceCents - b.priceCents);
    return all.length ? [{ ...k, best: all[0]!, count: all.length }] : [];
  });
  if (!rows.length) return <p className="py-2 text-sm text-text-muted">No offers found.</p>;
  // The verdict's pick (when given) marks its kind of deal, and that row shows the pick itself so prices match the verdict.
  const pick = offers.find((o) => o._id === bestOfferId);
  const pickKind = pick ? KINDS.find((k) => k.match(pick))?.key : undefined;

  return (
    <ul className="divide-y divide-border">
      {rows.map(({ key, label, best, count }) => {
        const isPick = key === pickKind;
        const price = isPick ? pick! : best;
        return (
          <li key={key} className="flex items-baseline gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className={cn("w-28 shrink-0 text-sm", isPick ? "text-text" : "text-text-muted")}>{label}</span>
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm text-text-muted">
              {price.url ? (
                <a href={price.url} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-2 hover:text-text hover:underline">
                  {price.seller} ↗
                </a>
              ) : (
                <span className="truncate">{price.seller}</span>
              )}
              {count > 1 ? <span className="shrink-0 text-xs">· {count} sellers</span> : null}
            </span>
            <span className={cn("num shrink-0 text-sm", isPick ? "text-accent" : "text-text")}>{fmtUSD(price.priceCents, { compact: true })}</span>
          </li>
        );
      })}
    </ul>
  );
}
