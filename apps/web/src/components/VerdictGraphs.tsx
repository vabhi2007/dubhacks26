"use client";
// The graphs inside an expanded VerdictCard (DESIGN.md §6), each in its own panel, in one horizontally scrolling row.
// Timekeeper: the trade-in curve with now/upgrade markers (from the verdict itself). Worth-It: 90-day price history with
// the likely low, payback (break-even) and the offers strip, from GET /products/:id. Mounted only when the card is first
// opened, so the fetch is lazy.
import { useEffect, useState } from "react";
import type { Verdict } from "@alfred/shared";
import { cn } from "@alfred/ui";
import { getProductDetail, type ProductDetail } from "../lib/api";
import { BreakEvenChart, OffersStrip, PriceHistoryChart } from "./productCharts";
import { TimekeeperChart } from "./TimekeeperChart";

/** Horizontal row of graph panels; scrolls sideways (snapping per panel) when they don't fit. */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">{children}</div>;
}

function Graph({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("shrink-0 snap-start border border-border bg-surface-2/40 p-4", wide ? "w-[480px]" : "w-[340px]")}>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function VerdictGraphs({ verdict }: { verdict: Verdict }) {
  if (verdict.timekeeper) {
    return (
      <Row>
        <Graph title="Trade-in value" wide>
          <TimekeeperChart className="h-56" series={verdict.timekeeper.tradeInSeries} waitMonths={verdict.timekeeper.waitMonths} />
        </Graph>
      </Row>
    );
  }
  return <WorthItGraphs verdict={verdict} />;
}

function WorthItGraphs({ verdict }: { verdict: Verdict }) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);

  useEffect(() => {
    let gone = false;
    getProductDetail(verdict.productId).then((r) => !gone && setDetail(r.data));
    return () => {
      gone = true;
    };
  }, [verdict.productId]);

  if (!detail) return <p className="text-sm text-text-muted">Loading charts…</p>;

  // The price this verdict expects to wait for (today's best minus the expected drop).
  const likelyLow = verdict.math.expectedDropCents ? verdict.math.priceCents - verdict.math.expectedDropCents : undefined;
  return (
    <Row>
      <Graph title="Price, last 90 days">
        <PriceHistoryChart history={detail.priceHistory} targetCents={likelyLow} />
      </Graph>
      {detail.breakEven ? (
        <Graph title="Pays for itself">
          <BreakEvenChart breakEven={detail.breakEven} />
        </Graph>
      ) : null}
      <Graph title="Offers">
        <OffersStrip offers={detail.offers} />
      </Graph>
    </Row>
  );
}
