// MoneyStat — a single headline number in tabular mono. DESIGN.md §6.
// Counts up from 0 on first render, then ticks between values (useCountUp; reduced motion → static).
"use client";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";
import { useCountUp } from "../entrance";

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
  const shown = useCountUp(cents);
  return (
    <div className={cn("rounded-card border border-border bg-surface p-5", className)}>
      <div className="text-sm text-text-muted">{label}</div>
      <div className={cn("num mt-1.5 text-[28px] leading-none tracking-tight", accent && "text-accent")}>
        {fmtUSD(Math.round(shown), { compact })}
      </div>
      {sub ? <div className="mt-2 text-xs text-text-muted">{sub}</div> : null}
    </div>
  );
}
