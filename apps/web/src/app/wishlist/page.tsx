"use client";
// Wishlist / Watcher — products Alfred is watching for a price drop (DESIGN.md F5).
// Live data from GET /wishlist (joined with product + best offer); fixture only when offline.
import { useEffect, useState } from "react";
import { fmtUSD } from "@alfred/shared";
import { cn } from "@alfred/ui";
import { getWishlist, type WatchView } from "../../lib/api";

const STATUS_STYLE: Record<WatchView["status"], string> = {
  watching: "text-accent bg-accent-subtle",
  triggered: "text-buy bg-buy/10",
  bought: "text-text-muted bg-surface-2",
  cancelled: "text-text-muted bg-surface-2",
};

function WatchRow({ w }: { w: WatchView }) {
  const best = w.bestOffer?.priceCents;
  const delta = best != null ? best - w.targetPriceCents : null; // >0 above target, <=0 at/below
  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-border bg-surface p-5">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium">{w.product?.title ?? w.productId}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
          <span>
            Target <span className="num text-text">{fmtUSD(w.targetPriceCents)}</span>
          </span>
          {best != null ? (
            <span>
              Best now <span className="num text-text">{fmtUSD(best)}</span>
              {w.bestOffer?.seller ? ` at ${w.bestOffer.seller}` : ""}
            </span>
          ) : null}
          {delta != null ? (
            <span className={cn("num", delta <= 0 ? "text-buy" : "text-text-muted")}>
              {delta <= 0 ? `${fmtUSD(-delta)} under target` : `${fmtUSD(delta)} to go`}
            </span>
          ) : null}
        </div>
      </div>
      <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", STATUS_STYLE[w.status])}>
        {w.status}
      </span>
    </div>
  );
}

export default function Wishlist() {
  const [watches, setWatches] = useState<WatchView[] | null>(null);

  useEffect(() => {
    getWishlist().then((r) => setWatches(r.data));
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">Wishlist</h1>
      <p className="mt-1 text-sm text-text-muted">
        Products Alfred is watching. When one drops to your target, it asks before buying.
      </p>

      {watches === null ? null : watches.length ? (
        <div className="mt-6 space-y-3">
          {watches.map((w) => (
            <WatchRow key={w._id} w={w} />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-card border border-border bg-surface p-6 text-sm text-text-muted">
          Nothing on your wishlist yet. Snap a product and tap “Watch for a drop.”
        </div>
      )}
    </div>
  );
}
