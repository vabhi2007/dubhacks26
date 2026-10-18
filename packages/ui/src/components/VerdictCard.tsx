// VerdictCard — the Worth-It / Timekeeper verdict, identical on web and extension.
// Presentational: callers pass their own action buttons via `actions` (Watch / Buy).
import type { ReactNode } from "react";
import type { Product, Verdict } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";
import { VerdictBadge } from "./VerdictBadge";

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-muted">
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
  if (m.expectedDropCents != null) chips.push(`~${fmtUSD(m.expectedDropCents)} likely drop`);
  const wait = v.timekeeper ? fmtMonths(v.timekeeper.waitMonths) : null;
  if (wait) chips.push(`Wait ${wait}mo`);
  return chips;
}

export function VerdictCard({
  verdict,
  product,
  actions,
  className,
}: {
  verdict: Verdict;
  product?: Pick<Product, "title" | "imageUrl">;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-border bg-surface p-6", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {product?.title ? (
            <div className="truncate text-sm text-text-muted">{product.title}</div>
          ) : null}
          <p className="mt-1 text-[20px] font-medium leading-snug tracking-tight">{verdict.headline}</p>
        </div>
        <VerdictBadge kind={verdict.kind} className="shrink-0" />
      </div>

      <ul className="mt-4 space-y-1.5">
        {verdict.reasons.map((r, i) => (
          <li key={`${i}-${r}`} className="flex gap-2 text-sm text-text-muted">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted/60" />
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

      {actions ? <div className="mt-5 flex gap-2">{actions}</div> : null}
    </div>
  );
}
