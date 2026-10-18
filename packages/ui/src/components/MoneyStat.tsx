// MoneyStat — a single headline number in tabular mono. DESIGN.md §6.
// Ticker animation lands in the MVP-3 motion pass; MVP-0 renders static.
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";

export function MoneyStat({
  label,
  cents,
  accent,
  sub,
  compact,
  className,
}: {
  label: string;
  cents: number;
  accent?: boolean;
  sub?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-border bg-surface p-5", className)}>
      <div className="text-sm text-text-muted">{label}</div>
      <div className={cn("num mt-1.5 text-[28px] leading-none tracking-tight", accent && "text-accent")}>
        {fmtUSD(cents, { compact })}
      </div>
      {sub ? <div className="mt-2 text-xs text-text-muted">{sub}</div> : null}
    </div>
  );
}
