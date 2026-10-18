"use client";
// Product-detail charts (DESIGN.md §6 data-viz). Colors from tokens (CSS vars work as SVG paint),
// minimal axes, key number labeled, money tooltips. One-time entrance motion lands in a later PR.
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Offer } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import type { BreakEven, PriceHistoryPoint } from "../lib/api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
const usd = (c: number) => fmtUSD(c, { compact: true });

const axis = { stroke: "var(--border)", tick: { fill: "var(--text-muted)", fontSize: 11 }, tickLine: false } as const;
const tooltipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 0,
    fontSize: 12,
    color: "var(--text)",
  },
  labelStyle: { color: "var(--text-muted)" },
} as const;

// Price history (90d): best price per day, gold line, dashed target line, dot at today.
export function PriceHistoryChart({ history, targetCents }: { history: PriceHistoryPoint[]; targetCents?: number }) {
  const byDay = new Map<string, number>();
  for (const p of history) {
    const k = dayLabel(p.ts);
    if (!k) continue;
    byDay.set(k, Math.min(byDay.get(k) ?? Infinity, p.priceCents));
  }
  const data = [...byDay.entries()].map(([label, price]) => ({ label, price }));
  if (data.length < 2) return <p className="py-6 text-sm text-text-muted">No recent price history.</p>;
  const last = data[data.length - 1];

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <XAxis dataKey="label" {...axis} interval={Math.ceil(data.length / 5)} minTickGap={16} />
        <YAxis {...axis} width={52} tickFormatter={usd} domain={["dataMin - 1000", "dataMax + 1000"]} />
        <Tooltip {...tooltipStyle} formatter={(v) => [fmtUSD(Number(v)), "Best price"]} />
        {targetCents != null ? (
          <ReferenceLine
            y={targetCents}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: `Target ${usd(targetCents)}`, position: "insideBottomLeft", fill: "var(--text-muted)", fontSize: 11 }}
          />
        ) : null}
        <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <ReferenceDot x={last.label} y={last.price} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Break-even: cumulative monthly savings bars vs a cost line at the price; crossing month labeled.
export function BreakEvenChart({ breakEven }: { breakEven: BreakEven }) {
  const data = breakEven.months.map((m) => ({ month: m.month, cum: m.cumulativeSavingsCents }));
  const crossing = breakEven.months.find((m) => m.cumulativeSavingsCents >= breakEven.priceCents)?.month;

  return (
    <div>
      <p className="mb-2 text-sm">
        {crossing != null ? (
          <>
            Breaks even · <span className="num font-medium text-buy">month {crossing}</span>
          </>
        ) : (
          <span className="text-text-muted">Doesn&rsquo;t break even within {breakEven.months.length - 1} months</span>
        )}
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <XAxis dataKey="month" {...axis} tickFormatter={(m: number) => `${m}mo`} interval={Math.ceil(data.length / 6)} />
          <YAxis {...axis} width={52} tickFormatter={usd} />
          <Tooltip {...tooltipStyle} formatter={(v) => [fmtUSD(Number(v)), "Saved"]} labelFormatter={(m) => `Month ${m}`} />
          <ReferenceLine
            y={breakEven.priceCents}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: `Cost ${usd(breakEven.priceCents)}`, position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 11 }}
          />
          <Bar dataKey="cum" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.month} fill={crossing != null && d.month >= crossing ? "var(--buy)" : "var(--accent)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const CONDITION_COLOR: Record<Offer["condition"], string> = {
  new: "var(--accent)",
  refurb: "var(--wait)",
  used: "var(--text-muted)",
};

// Offers on one price axis; best offer (first ranked) highlighted.
export function OffersStrip({ offers }: { offers: Offer[] }) {
  if (!offers.length) return <p className="py-2 text-sm text-text-muted">No offers found.</p>;
  const prices = offers.map((o) => o.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const pos = (c: number) => ((c - min) / span) * 100;

  return (
    <div>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {offers.map((o, i) => (
          <div
            key={o._id}
            title={`${o.seller} · ${fmtUSD(o.priceCents)} · ${o.condition}`}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos(o.priceCents)}%` }}
          >
            <span
              className={i === 0 ? "block size-3 ring-2 ring-surface" : "block size-2"}
              style={{ background: CONDITION_COLOR[o.condition] }}
            />
          </div>
        ))}
        <span className="num absolute left-0 top-0 text-[11px] text-text-muted">{fmtUSD(min)}</span>
        <span className="num absolute right-0 top-0 text-[11px] text-text-muted">{fmtUSD(max)}</span>
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-text-muted">
        {(["new", "refurb", "used"] as const).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 capitalize">
            <span className="size-2" style={{ background: CONDITION_COLOR[c] }} /> {c}
          </span>
        ))}
      </div>
    </div>
  );
}
