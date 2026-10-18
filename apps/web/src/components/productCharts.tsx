"use client";
// Product-detail charts (DESIGN.md §6 data-viz). Colors from tokens (CSS vars work as SVG paint),
// minimal axes, key number labeled, money tooltips. Lines draw in and bars grow once (useChartEntrance).
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
import { fmtUSD } from "@alfred/shared";
import { useChartEntrance } from "@alfred/ui";
import type { BreakEven, PriceHistoryPoint } from "../lib/api";
import { barTooltip, lineTooltip } from "./chartTheme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
const usd = (c: number) => fmtUSD(c, { compact: true });

const axis = { stroke: "var(--border)", tick: { fill: "var(--text-muted)", fontSize: 11 }, tickLine: false } as const;

// Price history (90d): best price per day, gold line, dashed target line, dot at today.
export function PriceHistoryChart({ history, targetCents }: { history: PriceHistoryPoint[]; targetCents?: number }) {
  const entrance = useChartEntrance(700);
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
        <Tooltip {...lineTooltip} formatter={(v) => [fmtUSD(Number(v)), "Best price"]} />
        {targetCents != null ? (
          <ReferenceLine
            y={targetCents}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: `Target ${usd(targetCents)}`, position: "insideBottomLeft", fill: "var(--text-muted)", fontSize: 11 }}
          />
        ) : null}
        <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={false} {...entrance} />
        <ReferenceDot x={last.label} y={last.price} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Break-even: cumulative monthly savings bars vs a cost line at the price; crossing month labeled.
export function BreakEvenChart({ breakEven }: { breakEven: BreakEven }) {
  const entrance = useChartEntrance();
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
          <Tooltip {...barTooltip} formatter={(v) => [fmtUSD(Number(v)), "Saved"]} labelFormatter={(m) => `Month ${m}`} />
          <ReferenceLine
            y={breakEven.priceCents}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: `Cost ${usd(breakEven.priceCents)}`, position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 11 }}
          />
          <Bar dataKey="cum" {...entrance}>
            {data.map((d) => (
              <Cell key={d.month} fill={crossing != null && d.month >= crossing ? "var(--buy)" : "var(--accent)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
