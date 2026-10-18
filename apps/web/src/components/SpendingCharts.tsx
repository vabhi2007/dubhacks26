"use client";
// Spending charts (DESIGN.md §6 data-viz). Both encode magnitude, so one hue (the accent), no categorical palette.
// Minimal axes, no dashed gridlines, hover tooltips; bars grow once on mount (useChartEntrance / CSS).
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtUSD } from "@alfred/shared";
import { useChartEntrance } from "@alfred/ui";
import type { SpendProfile } from "../lib/api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const monthLong = (ym: string) => `${monthLabel(ym)} ${ym.slice(0, 4)}`;
export const categoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
const usd = (c: number) => (c === 0 ? "$0" : fmtUSD(c, { compact: true }));

const axis = { stroke: "var(--border)", tick: { fill: "var(--text-muted)", fontSize: 11 }, tickLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 0, fontSize: 12, color: "var(--text)" },
  labelStyle: { color: "var(--text-muted)" },
  cursor: { fill: "var(--surface-2)" },
} as const;

/** Monthly spend, oldest → newest. Partial months (window edges) are dimmed and say so in the tooltip. */
/** Average of the full (non-partial) months — the line drawn on the chart. */
export const fullMonthAverage = (months: SpendProfile["byMonth"]) => {
  const full = months.filter((m) => !m.partial);
  return full.length ? Math.round(full.reduce((s, m) => s + m.totalCents, 0) / full.length) : 0;
};

export function MonthlyTrendChart({ months }: { months: SpendProfile["byMonth"] }) {
  const entrance = useChartEntrance();
  const data = months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const avg = fullMonthAverage(months);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barCategoryGap={6}>
        <XAxis dataKey="label" {...axis} interval={0} />
        <YAxis {...axis} width={52} tickFormatter={usd} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(_, p) => {
            const m = p?.[0]?.payload as (typeof data)[number] | undefined;
            return m ? `${monthLong(m.month)}${m.partial ? " · partial month" : ""}` : "";
          }}
          formatter={(v) => [fmtUSD(Number(v)), "Spent"]}
        />
        {/* Average line, unlabeled on the plot (a label collides with tall bars); the card header states it. */}
        {avg ? <ReferenceLine y={avg} stroke="var(--text-muted)" strokeOpacity={0.6} /> : null}
        <Bar dataKey="totalCents" {...entrance}>
          {data.map((m) => (
            <Cell key={m.month} fill="var(--accent)" fillOpacity={m.partial ? 0.35 : 0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ranked category bars as labeled rows: the value is always visible (not tooltip-only), one hue, grow-in once. */
export function CategoryBars({ categories, totalCents }: { categories: SpendProfile["byCategory"]; totalCents: number }) {
  const sorted = [...categories].sort((a, b) => b.totalCents - a.totalCents);
  const max = sorted[0]?.totalCents || 1;
  return (
    <ul className="stagger space-y-2.5">
      {sorted.map((c) => (
        <li key={c.category} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm" title={`${c.txCount} transactions`}>
          <span className="truncate text-text-muted">{categoryLabel(c.category)}</span>
          <span className="h-2 bg-surface-2">
            <span className="grow-x block h-full bg-accent" style={{ width: `${(c.totalCents / max) * 100}%` }} />
          </span>
          <span className="num w-28 text-right">
            {fmtUSD(c.totalCents, { compact: true })}
            <span className="ml-2 text-xs text-text-muted">{Math.round((c.totalCents / (totalCents || 1)) * 100)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
