// OfferBars — who sells it for what: one row per offer (seller, condition, a bar sized to the price, the price),
// cheapest first, with the best offer (the verdict's pick) in accent. DESIGN.md §6: tokens only, condition as text, not
// color alone. Replaces the unlabeled OffersStrip in verdict details; reusable on the product page.
import type { Offer } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "@alfred/ui";

const CONDITION_STYLE: Record<Offer["condition"], string> = {
  new: "text-text border-border",
  refurb: "text-text-muted border-border",
  used: "text-text-muted border-border border-dashed",
};

export function OfferBars({ offers, bestOfferId, max = 5 }: { offers: Offer[]; bestOfferId?: string; max?: number }) {
  if (!offers.length) return <p className="py-2 text-sm text-text-muted">No offers found.</p>;
  const best = offers.find((o) => o._id === bestOfferId) ?? offers[0]!;
  const byPrice = [...offers].sort((a, b) => a.priceCents - b.priceCents);
  // Cheapest first; always keep the best offer visible even if it isn't among the cheapest few.
  const rows = byPrice.slice(0, max);
  if (!rows.includes(best)) rows[rows.length - 1] = best;
  const top = Math.max(...rows.map((o) => o.priceCents));

  return (
    <ul className="space-y-2">
      {rows.map((o) => {
        const isBest = o._id === best._id;
        return (
          <li key={o._id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={cn("truncate text-sm", isBest ? "text-text" : "text-text-muted")} title={o.seller}>
                {o.seller}
              </span>
              <span className={cn("shrink-0 border px-1 text-[10px] uppercase leading-4 tracking-wide", CONDITION_STYLE[o.condition])}>
                {o.condition}
              </span>
            </div>
            <div className="h-2 bg-surface-2">
              <div
                className={cn("h-full", isBest ? "bg-accent" : "bg-text-muted/35")}
                style={{ width: `${Math.max(8, Math.round((o.priceCents / top) * 100))}%` }}
              />
            </div>
            <span className={cn("num w-16 text-right text-sm", isBest ? "text-accent" : "text-text-muted")}>
              {fmtUSD(o.priceCents, { compact: true })}
            </span>
          </li>
        );
      })}
      {offers.length > rows.length ? (
        <li className="text-xs text-text-muted">+{offers.length - rows.length} more</li>
      ) : null}
    </ul>
  );
}
