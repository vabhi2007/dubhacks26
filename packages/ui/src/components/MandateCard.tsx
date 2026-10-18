"use client";
// MandateCard — a scoped agent spending mandate rendered as a physical Visa card (DESIGN.md §6):
// 1.586:1, dark metallic gradient (gold tint when active), EMV chip, VISA wordmark, •••• last4 in
// Geist Mono, mandate label as the cardholder, MM/YY expiry, cap-usage bar along the bottom edge.
// Revoked cards are desaturated with a REVOKED stamp. Presentational; the caller wires onRevoke.
import type { Mandate } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";

const AGENT_LABEL: Partial<Record<Mandate["agent"], string>> = {
  watcher: "Watcher",
  smart_pay: "Smart Pay",
  rewards: "Rewards",
  orchestrator: "Alfred",
};

const expMMYY = (d: Date | string) => {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "--/--";
  return `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCFullYear() % 100).padStart(2, "0")}`;
};

function Chip() {
  return (
    <div className="h-7 w-9 rounded-[4px] bg-gradient-to-b from-[#F0D98A] to-[#C8A24A]">
      <div className="grid h-full w-full grid-cols-3 grid-rows-2 gap-px p-1 opacity-40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-[1px] bg-black/40" />
        ))}
      </div>
    </div>
  );
}

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
  const { label, agent, capCents, spentCents, expiresAt, status, card } = mandate;
  const pct = capCents > 0 ? Math.min(100, Math.round((spentCents / capCents) * 100)) : 0;
  const active = status === "active";
  const revoked = status === "revoked";

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "relative flex aspect-[1.586] w-full flex-col justify-between overflow-hidden rounded-card-visual p-5 text-white shadow-lg",
        )}
        style={{
          background: active
            ? "linear-gradient(135deg, #3b3017 0%, #1b1813 45%, #2c2416 100%)"
            : "linear-gradient(135deg, #2b2b30 0%, #151517 45%, #27272b 100%)",
          filter: revoked ? "grayscale(1)" : undefined,
        }}
      >
        <div className="flex items-start justify-between">
          <Chip />
          <span className="text-lg font-bold italic tracking-wider text-white/90">VISA</span>
        </div>

        <div className="font-mono text-xl tracking-[0.2em] text-white/95">•••• {card?.last4 ?? "0000"}</div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-white/50">{AGENT_LABEL[agent] ?? agent} mandate</div>
            <div className="truncate text-sm font-medium uppercase tracking-wide">{label}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="num text-xs text-white/90">
              {fmtUSD(spentCents)} / {fmtUSD(capCents)}
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-wide text-white/50">Exp {expMMYY(expiresAt)}</div>
          </div>
        </div>

        {/* cap-usage bar along the bottom edge */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
          <div className={cn("h-full", pct >= 100 ? "bg-skip" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>

        {revoked ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 border-4 border-skip/80 px-3 py-1 text-xl font-black uppercase tracking-widest text-skip/80">
              Revoked
            </span>
          </div>
        ) : null}
      </div>

      {active ? (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          className="mt-2 text-xs font-medium text-text-muted underline-offset-2 transition-colors hover:text-skip disabled:opacity-50"
        >
          Revoke mandate
        </button>
      ) : null}
    </div>
  );
}
