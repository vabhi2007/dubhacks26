"use client";
// MandateCard — a scoped agent spending mandate: cap progress, scope, expiry, and revoke.
// DESIGN.md §6. Presentational; the caller wires onRevoke.
import type { Mandate } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";
import { shortDate } from "../time";

const AGENT_LABEL: Partial<Record<Mandate["agent"], string>> = {
  watcher: "Watcher",
  smart_pay: "Smart Pay",
  rewards: "Rewards",
  orchestrator: "Alfred",
};

const STATUS_STYLE: Record<Mandate["status"], string> = {
  active: "text-accent bg-accent-subtle",
  revoked: "text-skip bg-skip/10",
  expired: "text-text-muted bg-surface-2",
};

export function MandateCard({
  mandate,
  busy,
  onRevoke,
  className,
}: {
  mandate: Mandate;
  busy?: boolean;
  onRevoke?: () => void;
  className?: string;
}) {
  const { label, agent, capCents, spentCents, categories, merchants, expiresAt, status, card } = mandate;
  const pct = capCents > 0 ? Math.min(100, Math.round((spentCents / capCents) * 100)) : 0;
  const scope = [...categories, ...merchants];

  return (
    <div className={cn("rounded-card-visual border border-border bg-surface p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium">{label}</div>
          <div className="mt-0.5 text-xs text-text-muted">
            {AGENT_LABEL[agent] ?? agent}
            {card?.last4 ? <> · ••{card.last4}</> : null}
          </div>
        </div>
        <span className={cn("shrink-0 rounded-none px-2.5 py-0.5 text-xs font-medium capitalize", STATUS_STYLE[status])}>
          {status}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="num">{fmtUSD(spentCents)}</span>
          <span className="num text-text-muted">of {fmtUSD(capCents)}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden bg-surface-2">
          <div className={cn("h-full", pct >= 100 ? "bg-skip" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {scope.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {scope.map((s) => (
            <span key={s} className="rounded-none border border-border bg-surface-2 px-2.5 py-1 text-xs capitalize text-text-muted">
              {s}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-text-muted">Expires {shortDate(expiresAt)}</span>
        {status === "active" ? (
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className="rounded-control border border-border px-3 py-1.5 text-sm font-medium text-skip transition-colors hover:bg-skip/10 disabled:opacity-50"
          >
            Revoke
          </button>
        ) : null}
      </div>
    </div>
  );
}
