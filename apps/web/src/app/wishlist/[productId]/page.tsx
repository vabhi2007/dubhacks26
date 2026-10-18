"use client";
// /wishlist/[productId] — the sub-page behind a watchlist row (DESIGN.md §6): price-history line
// chart (with target line + today dot), break-even bar chart, offers dot strip, and the verdict.
// Data from GET /products/:id (A); fixture bundle when offline.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { fmtUSD } from "@alfred/shared";
import { VerdictCard } from "@alfred/ui";
import { getProductDetail, type ProductDetail } from "../../../lib/api";
import { BreakEvenChart, PriceHistoryChart } from "../../../components/productCharts";
import { DealRows } from "../../../components/DealRows";

const initials = (title: string) =>
  title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

function SectionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">{label}</h2>
      {children}
    </section>
  );
}

function ProductDetail() {
  const { productId } = useParams<{ productId: string }>();
  const [detail, setDetail] = useState<ProductDetail | null>(null);

  useEffect(() => {
    if (productId) getProductDetail(productId).then((r) => setDetail(r.data));
  }, [productId]);

  const back = (
    <Link href="/wishlist" className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text">
      <ChevronLeft size={16} /> Wishlist
    </Link>
  );

  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        {back}
      </div>
    );
  }

  const { product, offers, priceHistory, latestVerdict, watch, breakEven } = detail;
  const best = offers[0]?.priceCents;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      {back}

      <header className="mt-4 flex items-center gap-4">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="size-16 shrink-0 border border-border object-cover" />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center bg-surface-2 text-lg font-medium text-text-muted">
            {initials(product.title)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate font-serif text-[28px] leading-tight tracking-tight">{product.title}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            {product.brand ? <span>{product.brand}</span> : null}
            {best != null ? (
              <span>
                Best <span className="num text-text">{fmtUSD(best)}</span>
              </span>
            ) : null}
            {watch ? (
              <span>
                Target <span className="num text-accent">{fmtUSD(watch.targetPriceCents)}</span>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {latestVerdict ? (
          <div className="lg:col-span-2">
            <VerdictCard verdict={latestVerdict} product={{ title: product.title, imageUrl: product.imageUrl }} />
          </div>
        ) : null}

        <SectionCard label="Price history · 90 days">
          <PriceHistoryChart history={priceHistory} targetCents={watch?.targetPriceCents} />
        </SectionCard>

        {breakEven ? (
          <SectionCard label="Break-even">
            <BreakEvenChart breakEven={breakEven} />
          </SectionCard>
        ) : null}

        <SectionCard label="Offers">
          <DealRows offers={offers} bestOfferId={latestVerdict?.math.bestOfferId} />
        </SectionCard>
      </div>
    </div>
  );
}

// useParams() needs a Suspense boundary so this dynamic route can prerender (Next 16 Cache Components).
export default function ProductDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-text-muted">Loading…</div>}>
      <ProductDetail />
    </Suspense>
  );
}
