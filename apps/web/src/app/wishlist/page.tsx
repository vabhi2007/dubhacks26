"use client";
// Wishlist / Watcher — compact rows (DESIGN.md §6): name + current price + target on the left, a
// small product image (monogram fallback) + › on the right, opening /wishlist/[productId].
// Live data from GET /wishlist; fixture only when offline.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fmtUSD } from "@alfred/shared";
import { getWishlist, type WatchView } from "../../lib/api";

const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

function WatchRow({ w }: { w: WatchView }) {
  const best = w.bestOffer?.priceCents;
  return (
    <Link
      href={`/wishlist/${w.productId}`}
      className="flex h-14 items-center gap-3 border border-border bg-surface px-4 transition-colors hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{w.product?.title ?? w.productId}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
          {best != null ? <span className="num text-text">{fmtUSD(best)}</span> : null}
          <span aria-hidden>·</span>
          <span>
            target <span className="num">{fmtUSD(w.targetPriceCents)}</span>
          </span>
        </div>
      </div>
      {w.product?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={w.product.imageUrl} alt="" className="size-9 shrink-0 border border-border object-cover" />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center bg-surface-2 text-xs font-medium text-text-muted">
          {initials(w.product?.title ?? "?")}
        </div>
      )}
      <ChevronRight size={16} className="shrink-0 text-text-muted" />
    </Link>
  );
}

export default function Wishlist() {
  const [watches, setWatches] = useState<WatchView[] | null>(null);

  useEffect(() => {
    getWishlist().then((r) => setWatches(r.data));
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="font-serif text-[28px] tracking-tight">Wishlist</h1>
      <p className="mt-1 text-sm text-text-muted">
        Products Alfred is watching. Open one for its price history, break-even, and offers.
      </p>

      {watches === null ? null : watches.length ? (
        <div className="mt-6 space-y-2">
          {watches.map((w) => (
            <WatchRow key={w._id} w={w} />
          ))}
        </div>
      ) : (
        <div className="mt-6 border border-border bg-surface p-6 text-sm text-text-muted">
          Nothing on your wishlist yet. Snap a product and tap “Watch for a drop.”
        </div>
      )}
    </div>
  );
}
