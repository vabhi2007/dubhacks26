// RewardCard — a loyalty program with its estimated $/yr and where that comes from (DESIGN.md §6, F6).
// Presentational and self-contained (props in) so it can move into @alfred/ui. Only the view's single primary
// action gets the gold button (§6: ≤ 1 primary action per view); the rest use the secondary style.
import { Check, ExternalLink } from "lucide-react";
import { fmtUSD } from "@alfred/shared";
import { cn } from "@alfred/ui";
import type { RewardRecommendation } from "../lib/api";

export function RewardCard({
  reward,
  primary,
  busy,
  onEnroll,
  className,
}: {
  reward: RewardRecommendation;
  primary?: boolean;
  busy?: boolean;
  onEnroll?: () => void;
  className?: string;
}) {
  const enrolled = reward.status === "enrolled";
  return (
    <div className={cn("flex flex-col rounded-card border border-border bg-surface p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium">{reward.name}</div>
          {reward.merchants.length ? <div className="mt-0.5 truncate text-xs text-text-muted">{reward.merchants.join(" · ")}</div> : null}
        </div>
        <div className="shrink-0 text-right">
          <span className="num text-[22px] leading-none tracking-tight">~{fmtUSD(reward.estAnnualValueCents, { compact: true })}</span>
          <span className="text-sm text-text-muted">/yr</span>
        </div>
      </div>

      <p className="mt-3 text-sm text-text-muted">{reward.why}</p>

      {reward.perks.length ? (
        <ul className="mt-3 space-y-1">
          {reward.perks.slice(0, 2).map((p) => (
            <li key={p} className="flex gap-2 text-xs text-text-muted">
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 bg-text-muted/60" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto pt-4">
        {enrolled ? (
          <span className="inline-flex items-center gap-1.5 bg-buy/10 px-2.5 py-1 text-xs font-medium text-buy">
            <Check size={14} strokeWidth={2} /> Enrolled
          </span>
        ) : (
          <button
            type="button"
            onClick={onEnroll}
            disabled={busy}
            className={cn(
              "rounded-control px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
              primary ? "btn-gold" : "border border-border hover:bg-surface-2",
            )}
          >
            {busy ? "Saving…" : (
              <span className="inline-flex items-center gap-1.5">
                Join <ExternalLink size={13} strokeWidth={2} aria-hidden />
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
