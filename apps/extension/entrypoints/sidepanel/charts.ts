// Owner: C. Geometry for the side panel's two tiny charts (DESIGN.md §6 data viz): the price-history sparkline and
// the offers dot strip. Pure functions, so the components only draw.
import type { Offer } from "@alfred/shared";

/** One row of A's GET /products/:id `priceHistory` (new + exact-match sellers, oldest first). */
export type HistoryPoint = { ts: string | Date; priceCents: number; seller?: string };
export type DayLow = { day: number; priceCents: number };

const DAY = 86_400_000;

/** One point per calendar day: the lowest price any tracked seller asked that day, oldest first. */
export function dailyLows(history: HistoryPoint[]): DayLow[] {
  const lows = new Map<number, number>();
  for (const p of history) {
    const t = new Date(p.ts).getTime();
    if (!Number.isFinite(t) || !(p.priceCents > 0)) continue;
    const day = Math.floor(t / DAY);
    lows.set(day, Math.min(lows.get(day) ?? Infinity, p.priceCents));
  }
  return [...lows].sort(([a], [b]) => a - b).map(([day, priceCents]) => ({ day, priceCents }));
}

export type Spark = {
  points: string; // SVG polyline points
  last: { x: number; y: number }; // "today" dot
  targetY?: number; // dashed watch-target line, when it's inside the chart's range
  lowCents: number;
  nowCents: number;
};

/** Fit the series into a width × height box (with `pad` inside); undefined when there's nothing to draw. */
export function sparkline(series: DayLow[], width: number, height: number, pad = 3, targetCents?: number): Spark | undefined {
  if (series.length < 2) return undefined;
  const prices = series.map((p) => p.priceCents);
  const lo = Math.min(...prices, targetCents ?? Infinity);
  const hi = Math.max(...prices);
  const span = hi - lo || 1;
  const d0 = series[0]!.day;
  const days = series.at(-1)!.day - d0 || 1;
  const x = (day: number) => pad + ((day - d0) / days) * (width - 2 * pad);
  const y = (c: number) => pad + (1 - (c - lo) / span) * (height - 2 * pad);
  const last = series.at(-1)!;
  return {
    points: series.map((p) => `${x(p.day).toFixed(1)},${y(p.priceCents).toFixed(1)}`).join(" "),
    last: { x: x(last.day), y: y(last.priceCents) },
    ...(targetCents !== undefined && targetCents >= lo && targetCents <= hi && { targetY: y(targetCents) }),
    lowCents: Math.min(...prices),
    nowCents: last.priceCents,
  };
}

export type StripDot = { offer: Offer; x: number; row: number };

/**
 * Lay offers out on one price axis (0–1 across the strip). Offers whose dots would overlap (within `minGap` of the
 * width) stack into extra rows instead of hiding each other. Domain is padded so end dots aren't clipped.
 */
export function stripLayout(offers: Offer[], minGap = 0.04): { lo: number; hi: number; dots: StripDot[]; rows: number } {
  if (!offers.length) return { lo: 0, hi: 0, dots: [], rows: 0 };
  const prices = offers.map((o) => o.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.06 || max * 0.1 || 1;
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const lastInRow: number[] = [];
  const dots = [...offers]
    .sort((a, b) => a.priceCents - b.priceCents)
    .map((offer) => {
      const x = (offer.priceCents - lo) / (hi - lo);
      let row = lastInRow.findIndex((prev) => x - prev >= minGap);
      if (row < 0) row = lastInRow.length;
      lastInRow[row] = x;
      return { offer, x, row };
    });
  return { lo, hi, dots, rows: lastInRow.length };
}
