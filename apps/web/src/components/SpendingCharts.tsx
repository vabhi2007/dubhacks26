"use client";
// Spending charts (DESIGN.md §6 data-viz). Both encode magnitude, so one hue (the accent), no categorical palette.
// Minimal axes, no dashed gridlines, hover tooltips; bars grow once on mount (useChartEntrance / CSS).
import { useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtUSD } from "@alfred/shared";
import { cn, useChartEntrance } from "@alfred/ui";
import type { SpendProfile } from "../lib/api";
import { barTooltip, plainTooltip } from "./chartTheme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const monthLong = (ym: string) => `${monthLabel(ym)} ${ym.slice(0, 4)}`;
export const categoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
const usd = (c: number) => (c === 0 ? "$0" : fmtUSD(c, { compact: true }));

const axis = { stroke: "var(--border)", tick: { fill: "var(--text-muted)", fontSize: 11 }, tickLine: false } as const;

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
          {...barTooltip}
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

type Slice = { key: string; label: string; totalCents: number; txCount: number; pct: number; opacity: number };

const TOP_SLICES = 6;
// One hue (§6: magnitude, not identity): the largest slice is the strongest accent, each next one lighter.
const SHADES = [1, 0.78, 0.6, 0.46, 0.35, 0.26, 0.18];

/** Top categories + "Other", as donut slices with their share of the total. */
function toSlices(categories: SpendProfile["byCategory"], totalCents: number): Slice[] {
  const sorted = [...categories].sort((a, b) => b.totalCents - a.totalCents);
  const top = sorted.slice(0, TOP_SLICES);
  const rest = sorted.slice(TOP_SLICES);
  const rows: Omit<Slice, "pct" | "opacity">[] = top.map((c) => ({ key: c.category, label: categoryLabel(c.category), totalCents: c.totalCents, txCount: c.txCount }));
  if (rest.length)
    // "__rest", not "other": "other" is a real category and can be among the top slices.
    rows.push({ key: "__rest", label: `Everything else (${rest.length})`, totalCents: rest.reduce((s, c) => s + c.totalCents, 0), txCount: rest.reduce((s, c) => s + c.txCount, 0) });
  const total = totalCents || rows.reduce((s, r) => s + r.totalCents, 0) || 1;
  return rows.map((r, i) => ({ ...r, pct: Math.round((r.totalCents / total) * 100), opacity: SHADES[i] ?? SHADES.at(-1)! }));
}

function SliceTooltip({ active, payload }: { active?: boolean; payload?: { payload: Slice }[] }) {
  const s = active ? payload?.[0]?.payload : undefined;
  if (!s) return null;
  return (
    <div style={plainTooltip.contentStyle} className="px-2.5 py-1.5">
      <div style={plainTooltip.labelStyle}>{s.label}</div>
      <div className="num" style={{ color: "var(--text)" }}>
        {fmtUSD(s.totalCents, { compact: true })} · {s.pct}%
      </div>
      <div style={{ color: "var(--text-muted)" }}>{s.txCount} transactions</div>
    </div>
  );
}

/**
 * Category share as a donut with a hover tooltip; the center shows the total, or the hovered slice. The legend keeps
 * every value visible (not tooltip-only) and highlights in sync with the donut.
 */
export function CategoryDonut({ categories, totalCents }: { categories: SpendProfile["byCategory"]; totalCents: number }) {
  const entrance = useChartEntrance();
  const [active, setActive] = useState<number | null>(null);
  const slices = toSlices(categories, totalCents);
  const focus = active != null ? slices[active] : undefined;

  return (
    // Stacked (donut, then legend): the card is half-width on desktop, too narrow for side-by-side with names.
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<SliceTooltip />} />
            <Pie
              data={slices}
              dataKey="totalCents"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={1.5}
              stroke="var(--surface)"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
              {...entrance}
            >
              {slices.map((s, i) => (
                <Cell
                  key={s.key}
                  fill="var(--accent)"
                  fillOpacity={active == null || active === i ? s.opacity : s.opacity * 0.35}
                  className="transition-[fill-opacity] duration-150 motion-reduce:transition-none"
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-text-muted">{focus ? focus.label : "12 months"}</span>
          <span className="num text-[20px] leading-tight">{fmtUSD(focus ? focus.totalCents : totalCents, { compact: true })}</span>
          {focus ? <span className="text-xs text-text-muted">{focus.pct}%</span> : null}
        </div>
      </div>

      <ul className="w-full space-y-0.5">
        {slices.map((s, i) => (
          <li
            key={s.key}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className={cn(
              "grid min-w-0 cursor-default grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-2.5 px-1.5 py-1 text-sm transition-colors",
              active === i && "bg-surface-2",
            )}
            title={`${s.txCount} transactions`}
          >
            <span className="h-2.5 w-2.5" style={{ background: "var(--accent)", opacity: s.opacity }} />
            <span className={cn("truncate", active === i ? "text-text" : "text-text-muted")}>{s.label}</span>
            <span className="num text-right">
              {fmtUSD(s.totalCents, { compact: true })}
              <span className="ml-2 inline-block w-8 text-xs text-text-muted">{s.pct}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
