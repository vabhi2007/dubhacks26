"use client";
// TimekeeperChart — trade-in value over the next months with "Now" and "Upgrade" markers (DESIGN.md §6, F8).
// Self-contained (props in, no fetching) so it can move into @alfred/ui for the extension; recharts is a web-only
// dependency today. No entrance animation: motion only on state change (§6).
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtUSD } from "@alfred/shared";

type Point = { month: number; valueCents: number };

const monthLabel = (m: number) => (m === 0 ? "Now" : `+${m}mo`);

export function TimekeeperChart({ series, waitMonths, className }: { series: Point[]; waitMonths: number; className?: string }) {
  const data = series.map((p) => ({ month: p.month, value: p.valueCents / 100 }));
  const at = (m: number) => data.find((d) => d.month === m)?.value;
  const now = at(0);
  const later = at(waitMonths);
  // Round y ticks ($50 steps, $100 for wide ranges) instead of recharts' odd auto values.
  const values = data.map((d) => d.value);
  const step = Math.max(...values) - Math.min(...values) > 300 ? 100 : 50;
  const lo = Math.max(0, Math.floor(Math.min(...values) / step) * step - step);
  const hi = Math.ceil(Math.max(...values) / step) * step;
  const yTicks = Array.from({ length: (hi - lo) / step + 1 }, (_, i) => lo + i * step);

  return (
    <div className={className} role="img" aria-label={`Trade-in value: ${now != null ? fmtUSD(now * 100) : "?"} now${waitMonths > 0 && later != null ? `, ${fmtUSD(later * 100)} in ${waitMonths} months` : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 32, right: 24, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            type="number"
            domain={[0, "dataMax"]}
            ticks={data.map((d) => d.month)}
            tickFormatter={monthLabel}
            stroke="var(--text-muted)"
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            width={56}
            tickFormatter={(v: number) => `$${v}`}
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={false}
            domain={[lo, hi]}
            ticks={yTicks}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 0, fontSize: 12 }}
            labelStyle={{ color: "var(--text-muted)" }}
            itemStyle={{ color: "var(--text)" }}
            labelFormatter={(m) => (m === 0 ? "Today" : `In ${m} month${m === 1 ? "" : "s"}`)}
            formatter={(v) => [fmtUSD(Number(v) * 100), "Trade-in"]}
          />
          <ReferenceLine x={0} stroke="var(--text-muted)" strokeDasharray="3 3" label={{ value: "Now", position: "top", fill: "var(--text-muted)", fontSize: 12 }} />
          {waitMonths > 0 ? (
            <ReferenceLine
              x={waitMonths}
              stroke="var(--accent)"
              strokeDasharray="3 3"
              label={{ value: `Upgrade · ${monthLabel(waitMonths)}`, position: "top", fill: "var(--accent)", fontSize: 12 }}
            />
          ) : null}
          {/* Straight segments: a trade-in cliff should look like one. */}
          <Line type="linear" dataKey="value" stroke="var(--text)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
          {now != null ? <ReferenceDot x={0} y={now} r={4} fill="var(--text-muted)" stroke="none" /> : null}
          {waitMonths > 0 && later != null ? <ReferenceDot x={waitMonths} y={later} r={5} fill="var(--accent)" stroke="none" /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
