"use client";
// The graphs inside an expanded VerdictCard (DESIGN.md §6): each in its own panel with one line under it saying what it
// shows, in a horizontally scrolling row. They replace the reason bullets and chips, so every number those carried lives
// in a caption here. Timekeeper: the trade-in curve (from the verdict itself). Worth-It: price history, payback and
// offers, from GET /products/:id — mounted only when the card is first opened, so the fetch is lazy.
import { useEffect, useState } from "react";
import { fmtUSD, type Verdict } from "@alfred/shared";
import { cn } from "@alfred/ui";
import { getProductDetail, type ProductDetail } from "../lib/api";
import { BreakEvenChart, OffersStrip, PriceHistoryChart } from "./productCharts";
import { TimekeeperChart } from "./TimekeeperChart";

// Whole dollars in captions ("$53/mo", "$30 above"); fmtUSD keeps cents under $100. Smart Pay keeps cents.
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const DAY = 86_400_000;

/** Horizontal row of graph panels; scrolls sideways (snapping per panel) when they don't fit. */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">{children}</div>;
}

function Graph({ title, caption, wide, children }: { title: string; caption?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("flex shrink-0 snap-start flex-col border border-border bg-surface-2/40 px-3 py-3", wide ? "w-[600px]" : "w-[440px]")}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
      {caption ? <p className="mt-2 text-sm leading-relaxed text-text-muted">{caption}</p> : null}
    </section>
  );
}

export function VerdictGraphs({ verdict }: { verdict: Verdict }) {
  const tk = verdict.timekeeper;
  if (tk) {
    return (
      <Row>
        <Graph title="Trade-in value" caption={tradeInCaption(tk)} wide>
          <TimekeeperChart className="h-56" series={tk.tradeInSeries} waitMonths={tk.waitMonths} />
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

  const m = verdict.math;
  // The price this verdict is waiting for (today's best minus the expected drop).
  const likelyLow = m.expectedDropCents ? m.priceCents - m.expectedDropCents : undefined;
  return (
    <Row>
      <Graph title="Price, last 90 days" caption={priceCaption(detail, m.priceCents, likelyLow)}>
        <PriceHistoryChart history={detail.priceHistory} targetCents={likelyLow} />
      </Graph>
      {detail.breakEven ? (
        <Graph title="Pays for itself" caption={paybackCaption(verdict, detail)}>
          <BreakEvenChart breakEven={detail.breakEven} />
        </Graph>
      ) : null}
      <Graph title="Offers" caption={offersCaption(verdict, detail)}>
        <OffersStrip offers={detail.offers} />
      </Graph>
    </Row>
  );
}

// ---------- captions: one throughline per graph, from the same numbers the reasons used ----------

/** History, not a forecast: how many separate times the best price reached the low (a gap > 2 days starts a new sale). */
function priceCaption(detail: ProductDetail, todayCents: number, lowCents?: number): string {
  if (lowCents == null) return `Today's best is ${usd(todayCents)}, close to its usual price — no repeated drops in 90 days.`;
  const lowDays = [...new Set(detail.priceHistory.filter((p) => p.priceCents <= lowCents).map((p) => Math.floor(Date.parse(p.ts) / DAY)))].sort((a, b) => a - b);
  const starts = lowDays.filter((d, i) => i === 0 || d - lowDays[i - 1]! > 2);
  const gap = starts.length > 1 ? Math.round((starts.at(-1)! - starts[0]!) / (starts.length - 1)) : undefined;
  const times = starts.length === 1 ? "once" : `${starts.length} times`;
  const every = gap == null ? "" : gap >= 10 ? `, about every ${Math.round(gap / 7)} weeks` : `, about every ${gap} days`;
  return `Hit ${usd(lowCents)} ${times} in 90 days${every}. Today's ${usd(todayCents)} is ${usd(todayCents - lowCents)} above that.`;
}

function paybackCaption(verdict: Verdict, detail: ProductDetail): string {
  const m = verdict.math;
  const be = detail.breakEven!;
  const months = m.paybackMonths != null ? Math.round(m.paybackMonths * 10) / 10 : undefined;
  const payback = `~${usd(be.monthlySavingsCents)}/mo you already spend on this${months ? ` pays it back in ~${months} months` : ""}.`;
  const budget = m.budgetImpactPct != null ? ` ${usd(m.priceCents)} is ${Math.round(m.budgetImpactPct * 100)}% of your monthly ${detail.product.category} budget.` : "";
  return payback + budget;
}

function offersCaption(verdict: Verdict, detail: ProductDetail): string {
  const best = detail.offers.find((o) => o._id === verdict.math.bestOfferId) ?? detail.offers[0];
  if (!best) return "No offers found.";
  const back = verdict.smartPay ? ` · +${fmtUSD(verdict.smartPay.rewardCents)} back with Smart Pay` : "";
  const cheaper = detail.offers.filter((o) => o.condition !== "new" && o.priceCents < best.priceCents).sort((a, b) => a.priceCents - b.priceCents)[0];
  return `Best: ${usd(best.priceCents)} ${best.condition} at ${best.seller}${back}.${cheaper ? ` ${cheaper.condition === "used" ? "Used" : "Refurb"} from ${usd(cheaper.priceCents)}.` : ""}`;
}

function tradeInCaption(tk: NonNullable<Verdict["timekeeper"]>): string {
  const at = (m: number) => tk.tradeInSeries.find((p) => p.month === m)?.valueCents;
  const now = at(0);
  if (tk.waitMonths <= 0) {
    const end = tk.tradeInSeries.at(-1);
    return `Your trade-in only falls from here${now != null && end ? ` (${usd(now)} → ${usd(end.valueCents)} in ${end.month} months)` : ""}. Upgrading today costs ${usd(tk.costNowCents)} out of pocket.`;
  }
  const then = at(tk.waitMonths);
  const next = at(tk.waitMonths + 1);
  const cliff = then != null && next != null && then - next > 0 ? `, then drops ${usd(then - next)}` : "";
  return `${now != null ? `${usd(now)} trade-in today → ` : ""}${then != null ? `${usd(then)} by month ${tk.waitMonths}${cliff}. ` : ""}Upgrading then costs ${usd(tk.costLaterCents)} out of pocket vs ${usd(tk.costNowCents)} today.`;
}
