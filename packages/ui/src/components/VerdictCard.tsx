"use client";
// VerdictCard — the Worth-It / Timekeeper verdict, identical on web and extension.
// Header: image, product, badge (with how long to wait), an eye + price when Alfred is watching it, and a caret that
// expands the reasons, math chips, Smart Pay, then the caller's `details` (graphs) — mounted only once opened, so they can
// fetch lazily. The headline is left to the surrounding copy (chat reply, feed) unless there's no product title.
// Presentational: callers pass their own action buttons via `actions` (Watch / Buy).
import { type ReactNode, useId, useState } from "react";
import type { Product, Verdict } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";
import { VerdictBadge, waitDetail } from "./VerdictBadge";

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-none border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-muted">
      {label}
    </span>
  );
}

// Months from Claude can be noisy (e.g. 3.3333); show at most one decimal, no trailing ".0".
// Returns null for values that would read as nonsense (≤0 after rounding, NaN, Infinity) so the chip is skipped.
const fmtMonths = (m: number) => {
  const r = Math.round(m * 10) / 10;
  return Number.isFinite(r) && r > 0 ? r.toString() : null;
};

function mathChips(v: Verdict): string[] {
  const m = v.math;
  const chips: string[] = [`Price ${fmtUSD(m.priceCents)}`];
  const payback = m.paybackMonths != null ? fmtMonths(m.paybackMonths) : null;
  if (payback) chips.push(`Pays back in ${payback}mo`);
  if (m.relatedSpend12moCents != null) chips.push(`${fmtUSD(m.relatedSpend12moCents, { compact: true })}/yr related`);
  if (m.budgetImpactPct != null) chips.push(`${Math.round(m.budgetImpactPct * 100)}% of budget`);
  if (m.expectedDropCents) chips.push(`~${fmtUSD(m.expectedDropCents)} likely drop`);
  return chips;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn("h-5 w-5 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

function Eye() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export function VerdictCard({
  verdict,
  product,
  actions,
  watchingCents,
  details,
  defaultOpen = false,
  className,
}: {
  verdict: Verdict;
  product?: Pick<Product, "title" | "imageUrl">;
  actions?: ReactNode;
  /** Alfred is watching this product: the price it will buy at (shown as an eye + price next to the badge). */
  watchingCents?: number;
  /** Extra expanded content (e.g. graphs). Rendered only after the first open. */
  details?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [opened, setOpened] = useState(defaultOpen); // keep details mounted after first open (no refetch on re-open)
  const panelId = useId();
  const toggle = () => {
    setOpen((o) => !o);
    setOpened(true);
  };

  return (
    <div className={cn("rounded-card border border-border bg-surface p-6", className)}>
      <div className="flex items-center gap-4">
        {product?.imageUrl ? (
          // Plain <img>: this card is shared with the extension, which has no next/image.
          <img
            src={product.imageUrl}
            alt=""
            className="h-16 w-16 shrink-0 border border-border bg-surface-2 object-contain"
            loading="lazy"
          />
        ) : null}
        <p className="line-clamp-2 min-w-0 flex-1 font-serif text-[18px] leading-snug tracking-tight" title={product?.title || verdict.headline}>
          {product?.title || verdict.headline}
        </p>
        <VerdictBadge kind={verdict.kind} detail={waitDetail(verdict)} className="shrink-0" />
        {watchingCents != null ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-accent" title={`Watching — buys at ${fmtUSD(watchingCents)}`}>
            <Eye />
            <span className="num text-sm">{fmtUSD(watchingCents, { compact: true })}</span>
            <span className="sr-only">Watching — buys at {fmtUSD(watchingCents)}</span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Hide details" : "Show details"}
          className="-mr-1.5 shrink-0 p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Chevron open={open} />
        </button>
      </div>

      {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}

      {/* grid-rows 0fr → 1fr animates to the content's natural height; instant under reduced motion. */}
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className="mt-5 border-t border-border pt-5">
            <ul className="space-y-1.5">
              {verdict.reasons.map((r, i) => (
                <li key={`${i}-${r}`} className="flex gap-2 text-sm text-text-muted">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 bg-text-muted/60" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {mathChips(verdict).map((c, i) => (
                <Chip key={`${i}-${c}`} label={c} />
              ))}
            </div>

            {verdict.smartPay ? (
              <div className="mt-4 rounded-control border border-border bg-surface-2 px-3 py-2 text-sm">
                <span className="text-text-muted">Smart Pay: </span>
                <span className="num text-accent">+{fmtUSD(verdict.smartPay.rewardCents)}</span>
                <span className="text-text-muted"> back on this card</span>
              </div>
            ) : null}

            {details && opened ? <div className="mt-6">{details}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
