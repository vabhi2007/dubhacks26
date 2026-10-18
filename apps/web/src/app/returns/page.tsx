"use client";
// Returns — every purchase's return window (DESIGN.md F5): how long is left, and a nudge when it got cheaper while a
// return is still possible. Live from GET /returns; fixture only when the agent is offline.
import { useEffect, useState } from "react";
import { fmtUSD } from "@alfred/shared";
import { cn, MoneyStat, shortDate } from "@alfred/ui";
import { getReturns, type ReturnWindow } from "../../lib/api";

const usd = (c: number) => fmtUSD(c, { compact: true });

function Chip({ r }: { r: ReturnWindow }) {
  const [label, tone] =
    r.status === "seller" ? ["Seller's terms", "text-text-muted bg-surface-2"]
    : r.status === "closed" ? ["Closed", "text-text-muted bg-surface-2"]
    : r.status === "closing" ? [`${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`, "text-on-accent bg-accent"]
    : [`${r.daysLeft} days left`, "text-accent bg-accent-subtle"];
  return <span className={cn("num shrink-0 px-2.5 py-0.5 text-xs font-semibold", tone)}>{label}</span>;
}

function Row({ r }: { r: ReturnWindow }) {
  const done = r.status === "closed";
  const elapsed = r.windowDays && r.daysLeft != null ? Math.min(100, Math.round(((r.windowDays - r.daysLeft) / r.windowDays) * 100)) : 0;
  return (
    <li className={cn("border border-border bg-surface p-4", done && "opacity-60")}>
      <div className="flex items-center gap-4">
        {r.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote product images from mixed hosts
          <img src={r.imageUrl} alt="" className="h-14 w-14 shrink-0 border border-border bg-surface-2 object-contain" loading="lazy" />
        ) : (
          <div className="h-14 w-14 shrink-0 border border-border bg-surface-2" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{r.title}</div>
          <div className="mt-0.5 text-sm text-text-muted">
            <span className="num text-text">{usd(r.amountCents)}</span> at {r.seller} · bought {shortDate(r.boughtAt)}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Chip r={r} />
          <span className="text-xs text-text-muted">
            {r.status === "seller" ? r.policyNote : r.returnBy ? `${done ? "Closed" : "Return by"} ${shortDate(r.returnBy)}` : null}
          </span>
        </div>
      </div>

      {r.windowDays ? (
        <div className="mt-3">
          <div className="h-1 bg-surface-2">
            <div className={cn("h-full", done ? "bg-text-muted/40" : r.status === "closing" ? "bg-accent" : "bg-accent/60")} style={{ width: `${elapsed}%` }} />
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {!r.estimated
              ? `${r.seller}'s typical ${r.windowDays}-day window.`
              : r.seller === "Unknown seller"
                ? `Couldn't tell where this was bought — assuming a typical ${r.windowDays}-day window. Check your receipt.`
                : `No published policy for ${r.seller} — assuming a typical ${r.windowDays}-day window. Check your receipt.`}
          </div>
        </div>
      ) : null}

      {r.priceDrop ? (
        <p className="mt-3 border-l-2 border-buy pl-3 text-sm">
          <span className="text-buy">Now {usd(r.priceDrop.nowCents)} at {r.priceDrop.seller} — {usd(r.priceDrop.savingsCents)} less.</span>{" "}
          <span className="text-text-muted">Return and rebuy, or ask {r.seller} for a price adjustment before {r.returnBy ? shortDate(r.returnBy) : "the window closes"}.</span>
        </p>
      ) : null}
    </li>
  );
}

export default function Returns() {
  const [rows, setRows] = useState<ReturnWindow[] | null>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    getReturns().then((r) => {
      setRows(r.data);
      setLive(r.live);
    });
  }, []);

  const returnable = rows?.filter((r) => r.status === "open" || r.status === "closing") ?? [];
  const closing = returnable.filter((r) => r.status === "closing");
  const savings = returnable.reduce((s, r) => s + (r.priceDrop?.savingsCents ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="font-serif text-[28px] tracking-tight">Returns</h1>
      <p className="mt-1 text-sm text-text-muted">Every purchase&apos;s return window — and a heads-up when it gets cheaper while you can still return it.</p>

      {rows === null ? null : !rows.length ? (
        <div className="mt-6 border border-border bg-surface p-6 text-sm text-text-muted">
          Nothing bought yet. When Alfred buys something for you, its return window shows up here.
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <MoneyStat label="Price drops you can claim" cents={savings} accent={savings > 0} sub={savings ? "return & rebuy, or ask for an adjustment" : "nothing cheaper right now"} />
            <div className="border border-border bg-surface p-5">
              <div className="text-sm text-text-muted">Still returnable</div>
              <div className="num mt-1.5 text-[28px] leading-none tracking-tight">{returnable.length}</div>
            </div>
            <div className="border border-border bg-surface p-5">
              <div className="text-sm text-text-muted">Closing this week</div>
              <div className={cn("num mt-1.5 text-[28px] leading-none tracking-tight", closing.length && "text-accent")}>{closing.length}</div>
            </div>
          </div>
          <ul className="mt-6 space-y-3">
            {rows.map((r) => (
              <Row key={r.orderId} r={r} />
            ))}
          </ul>
          {!live ? <p className="mt-6 text-xs text-text-muted">Agent offline — showing a saved example.</p> : null}
        </>
      )}
    </div>
  );
}
