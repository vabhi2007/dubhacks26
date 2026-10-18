// Owner: C. Local side-panel components on @alfred/ui tokens. Replace with D's shared components as they land.
import { useState, type ReactNode } from "react";
import { fmtUSD, type AgentEvent, type Offer, type Product, type Verdict } from "@alfred/shared";
import { cn, FeedItem, VerdictBadge } from "@alfred/ui";
import { statusFromItem, type WatchStatus } from "./watchStatus";

export function ProductHeader({ product }: { product: Product }) {
  return (
    <div className="flex items-center gap-3">
      {product.imageUrl && <img src={product.imageUrl} alt="" className="size-14 rounded-control border border-border object-cover" />}
      <div className="min-w-0">
        <div className="truncate font-medium">{product.title}</div>
        {(product.brand || product.model) && <div className="text-xs text-text-muted">{[product.brand, product.model].filter(Boolean).join(" · ")}</div>}
      </div>
    </div>
  );
}

export function VerdictCard({ verdict }: { verdict: Verdict }) {
  const { math } = verdict;
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <VerdictBadge kind={verdict.kind} />
        {math.priceCents > 0 && <span className="num text-2xl text-accent">{fmtUSD(math.priceCents)}</span>}
      </div>
      <p className="mt-3 text-base font-medium leading-snug">{verdict.headline}</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm text-text-muted">
        {verdict.reasons.map((r) => (
          <li key={r} className="flex gap-2"><span aria-hidden className="text-accent">•</span>{r}</li>
        ))}
      </ul>
      {(math.paybackMonths != null || !!math.expectedDropCents) && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
          {math.paybackMonths != null && <Stat label="Payback" value={`${math.paybackMonths} mo`} />}
          {!!math.expectedDropCents && <Stat label="Likely drop" value={fmtUSD(math.expectedDropCents)} />}
        </dl>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="num mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

export function OfferList({ offers, bestOfferId }: { offers: Offer[]; bestOfferId?: string }) {
  const fresh = offers.filter((o) => o.condition === "new");
  const second = offers.filter((o) => o.condition !== "new");
  if (!offers.length) return <p className="text-sm text-text-muted">No offers found.</p>;
  return (
    <section className="flex flex-col gap-3">
      <OfferGroup title="New" offers={fresh} bestOfferId={bestOfferId} />
      <OfferGroup title="Used & refurbished" offers={second} />
    </section>
  );
}

function OfferGroup({ title, offers, bestOfferId }: { title: string; offers: Offer[]; bestOfferId?: string }) {
  if (!offers.length) return null;
  return (
    <div>
      <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</h2>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {offers.map((o) => (
          <li key={o._id}>
            <a
              href={o.url}
              target="_blank"
              rel="noreferrer"
              className={cn("flex items-center justify-between px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-surface-2", o._id === bestOfferId && "bg-accent-subtle")}
            >
              <span className="flex items-center gap-2">
                {o.seller}
                {o.condition !== "new" && <Chip>{o.condition}</Chip>}
                {o.matched === "variant" && <Chip>variant</Chip>}
                {o.region !== "US" && <Chip>{o.region}</Chip>}
              </span>
              <span className="num">{fmtUSD(o.priceCents)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">{children}</span>;
}

type WatchState = { kind: "idle" | "saving" } | { kind: "error"; message: string };

const DEFAULT_DISCOUNT = 0.1; // no expected drop → watch for 10% off

/**
 * The Watcher (B) buys as soon as the best price is ≤ target, so the target must be strictly below today's price —
 * otherwise "Watch" is an immediate purchase. Expected drop when there is one, else 10% off; undefined if neither fits.
 */
export function watchTarget(priceCents: number, expectedDropCents = 0): number | undefined {
  const t = expectedDropCents > 0 && expectedDropCents < priceCents ? priceCents - expectedDropCents : Math.floor(priceCents * (1 - DEFAULT_DISCOUNT));
  return t >= 1 && t < priceCents ? t : undefined;
}

const statusLabel = (s: WatchStatus, target?: string) =>
  s.kind === "watching" ? (target ? `Watching — buys at ${target} or less` : "Watching this price")
  : s.kind === "approval" ? "Price hit — waiting for your approval"
  : "Bought";

/**
 * POST /wishlist (B). The Watcher may buy at the target through a mandate, or ask first — the label says so.
 * `status` is the live watch state for this product (watchStatus.ts); once known, it drives the label.
 */
export function WatchButton({ agentUrl, product, verdict, status, onStatus }: {
  agentUrl: string; product: Product; verdict: Verdict; status: WatchStatus | null; onStatus: (s: WatchStatus) => void;
}) {
  const [state, setState] = useState<WatchState>({ kind: "idle" });
  const target = watchTarget(verdict.math.priceCents, verdict.math.expectedDropCents);
  if (target === undefined && !status) return null;

  const watch = async () => {
    if (target === undefined) return;
    setState({ kind: "saving" });
    try {
      const res = await fetch(`${agentUrl}/wishlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product._id, targetPriceCents: target, surface: "extension" }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 501) throw new Error("Watching isn't live yet on the agent.");
      if (res.status === 503) throw new Error("Watching needs the agent's database (MONGODB_URI).");
      if (!res.ok) throw new Error(body?.error ?? `Agent returned ${res.status}`);
      onStatus(statusFromItem(body?.status ?? "watching") ?? { kind: "watching" });
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof TypeError ? "Couldn't reach the agent." : (e as Error).message });
    }
  };

  const shown = target === undefined ? undefined : fmtUSD(target);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={watch}
        disabled={!!status || state.kind === "saving"}
        className={cn(
          "rounded-control px-4 py-2.5 text-sm font-medium transition-colors duration-150 disabled:opacity-100",
          status?.kind === "bought" ? "bg-buy/15 text-buy" : status ? "bg-accent-subtle text-text" : "bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-60",
        )}
      >
        <span key={status?.kind ?? state.kind} className="fade-in inline-block">
          {status ? statusLabel(status, shown) : state.kind === "saving" ? "Saving…" : `Watch — buy at ${shown} or less`}
        </span>
      </button>
      {status?.note ? (
        <p key={status.note} className="fade-in text-xs text-text-muted">{status.note}</p>
      ) : !status && state.kind === "idle" ? (
        <p className="text-xs text-text-muted">Buys through a mandate if one covers it; otherwise asks you first.</p>
      ) : null}
      {state.kind === "error" && <p role="alert" className="text-xs text-skip">{state.message}</p>}
    </div>
  );
}

/** What Alfred has been doing, live (D's FeedItem, same as the dashboard feed). */
export function ActivityFeed({ events }: { events: AgentEvent[] }) {
  if (!events.length) return null;
  return (
    <section>
      <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Recent activity</h2>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface px-4">
        {events.map((e) => (
          <FeedItem key={e._id} event={e} className="fade-in" />
        ))}
      </ul>
    </section>
  );
}
