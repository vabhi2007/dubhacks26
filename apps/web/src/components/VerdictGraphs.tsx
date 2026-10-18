"use client";
// The graphs inside an expanded VerdictCard (DESIGN.md §6). Timekeeper: the trade-in curve with now/upgrade markers
// (from the verdict itself). Worth-It: 90-day price history with the likely low, payback (break-even) and the offers
// strip, from GET /products/:id. Mounted only when the card is first opened, so the fetch is lazy.
import { useEffect, useState } from "react";
import type { Verdict } from "@alfred/shared";
import { getProductDetail, type ProductDetail } from "../lib/api";
import { BreakEvenChart, OffersStrip, PriceHistoryChart } from "./productCharts";
import { TimekeeperChart } from "./TimekeeperChart";

function Graph({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function VerdictGraphs({ verdict }: { verdict: Verdict }) {
  if (verdict.timekeeper) {
    return (
      <Graph title="Trade-in value">
        <TimekeeperChart className="h-56" series={verdict.timekeeper.tradeInSeries} waitMonths={verdict.timekeeper.waitMonths} />
      </Graph>
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
    <>
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
    </>
  );
}
