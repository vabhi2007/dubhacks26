// One tooltip look for every recharts chart (DESIGN.md §6 tokens). recharts colors each tooltip row with its series
// color, and per-bar <Cell> fills leave that unset, so rows fell back to black on our dark surface — set it explicitly.
// The hover cursor is a token too (recharts' default is a light-gray band).
const base = {
  contentStyle: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 0, fontSize: 12, color: "var(--text)" },
  labelStyle: { color: "var(--text-muted)", marginBottom: 2 },
  itemStyle: { color: "var(--text)", padding: 0 },
} as const;

/** Bar charts: a subtle band behind the hovered bar. */
export const barTooltip = { ...base, cursor: { fill: "var(--surface-2)", fillOpacity: 0.6 } } as const;
/** Line charts: a hairline at the hovered x. */
export const lineTooltip = { ...base, cursor: { stroke: "var(--border)" } } as const;
/** Charts with no axis cursor (pie/donut). */
export const plainTooltip = base;
