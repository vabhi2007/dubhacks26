// Owner: C. Side-panel components on @alfred/ui tokens (DESIGN.md §6): square corners, DM Serif titles, Inter Tight
// money (.num), gold-gradient primary action, charts over lists. Kept compact: reasons cap at 2 lines.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtUSD, watchTarget, type Offer, type Product, type Verdict } from "@alfred/shared";
import { cn, VerdictBadge } from "@alfred/ui";
import { dailyLows, sparkline, stripLayout, type DayLow } from "./charts";
import { statusFromItem, type WatchStatus } from "./watchStatus";

export function ProductHeader({ product }: { product: Product }) {
  return (
    <div className="flex items-center gap-3">
      {product.imageUrl && <img src={product.imageUrl} alt="" className="size-14 shrink-0 border border-border object-cover" />}
      <div className="min-w-0">
        <h2 className="line-clamp-2 font-serif text-[20px] leading-tight">{product.title}</h2>
        {(product.brand || product.model) && (
          <div className="mt-0.5 truncate text-xs text-text-muted">{[product.brand, product.model].filter(Boolean).join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

export function VerdictCard({ verdict }: { verdict: Verdict }) {
  const { math } = verdict;
  return (
    <section className="border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <VerdictBadge kind={verdict.kind} />
        {math.priceCents > 0 && <span className="num text-[28px] leading-none text-accent">{fmtUSD(math.priceCents)}</span>}
      </div>
      <p className="mt-3 text-[15px] font-medium leading-snug">{verdict.headline}</p>
      <Reasons reasons={verdict.reasons} />
      {(math.paybackMonths != null || !!math.expectedDropCents) && (
        <dl className="mt-3 flex gap-6 border-t border-border pt-3 text-xs">
          {math.paybackMonths != null && <Stat label="Payback" value={`${math.paybackMonths} mo`} />}
          {!!math.expectedDropCents && <Stat label="Likely drop" value={fmtUSD(math.expectedDropCents)} />}
        </dl>
      )}
    </section>
  );
}

/** Reasons as one muted paragraph clamped to 2 lines; "more" opens them as a list (only offered when clipped). */
function Reasons({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [reasons, open]);

  return (
    <div className="mt-1.5 text-sm text-text-muted">
      {open ? (
        <ul className="flex flex-col gap-1">
          {reasons.map((r) => (
            <li key={r} className="flex gap-2"><span aria-hidden className="text-accent">•</span>{r}</li>
          ))}
        </ul>
      ) : (
        <p ref={ref} className="line-clamp-2">{reasons.join(" · ")}</p>
      )}
      {(clipped || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-xs font-medium text-text hover:underline">
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className="num text-sm">{value}</dd>
    </div>
  );
}

const SPARK_W = 280;
const SPARK_H = 40;

/**
 * Tiny 90-day price sparkline from A's GET /products/:id (`priceHistory`, daily lows across new/exact sellers):
 * gold line, dashed line at the watch target, dot at today. Hidden when there's no history.
 */
export function PriceHistory({ agentUrl, productId, targetCents }: { agentUrl: string; productId: string; targetCents?: number }) {
  const [series, setSeries] = useState<DayLow[] | null>(null);
  useEffect(() => {
    setSeries(null);
    let active = true;
    fetch(`${agentUrl}/products/${encodeURIComponent(productId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && setSeries(dailyLows(Array.isArray(d?.priceHistory) ? d.priceHistory : [])))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [agentUrl, productId]);

  const s = series ? sparkline(series, SPARK_W, SPARK_H, 3, targetCents) : undefined;
  if (!s) return null;
  return (
    <section className="fade-in">
      <div className="flex items-baseline justify-between text-xs text-text-muted">
        <h3 className="font-medium uppercase tracking-wide">90-day price</h3>
        <span>
          low <span className="num text-text">{fmtUSD(s.lowCents)}</span>
          {targetCents !== undefined && <> · target <span className="num text-text">{fmtUSD(targetCents)}</span></>}
        </span>
      </div>
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="mt-1 block h-auto w-full" role="img" aria-label={`90-day low ${fmtUSD(s.lowCents)}, today ${fmtUSD(s.nowCents)}`}>
        {s.targetY !== undefined && <line x1={0} x2={SPARK_W} y1={s.targetY} y2={s.targetY} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3" />}
        <polyline points={s.points} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" pathLength={1} className="spark-draw" />
        <circle cx={s.last.x} cy={s.last.y} r={2.5} fill="var(--accent)" />
      </svg>
    </section>
  );
}

const ROW_H = 12;
const CONDITION_DOT: Record<Offer["condition"], string> = {
  new: "bg-text",
  refurb: "border border-text bg-surface",
  used: "border border-text-muted bg-transparent",
};

/** Every offer as a dot on one price axis (new / refurb / used), best offer highlighted and named below. */
export function OfferStrip({ offers, bestOfferId }: { offers: Offer[]; bestOfferId?: string }) {
  if (!offers.length) return <p className="text-sm text-text-muted">No offers found.</p>;
  const { dots, rows } = stripLayout(offers);
  const best = offers.find((o) => o._id === bestOfferId) ?? dots[0]!.offer;
  const prices = offers.map((o) => o.priceCents);
  const count = (c: Offer["condition"]) => offers.filter((o) => o.condition === c).length;

  return (
    <section>
      <div className="flex items-baseline justify-between text-xs text-text-muted">
        <h3 className="font-medium uppercase tracking-wide">Offers</h3>
        <span className="flex items-center gap-2.5">
          <Legend dot={CONDITION_DOT.new} label={`New ${count("new")}`} />
          {count("refurb") > 0 && <Legend dot={CONDITION_DOT.refurb} label={`Refurb ${count("refurb")}`} />}
          {count("used") > 0 && <Legend dot={CONDITION_DOT.used} label={`Used ${count("used")}`} />}
        </span>
      </div>
      <div className="relative mt-2 border-b border-border" style={{ height: 8 + rows * ROW_H }}>
        {dots.map(({ offer: o, x, row }) => {
          const isBest = o._id === best._id;
          return (
            <a
              key={o._id}
              href={o.url}
              target="_blank"
              rel="noreferrer"
              title={`${o.seller} · ${fmtUSD(o.priceCents)} · ${o.condition}${o.matched === "variant" ? " · variant" : ""}${o.region !== "US" ? ` · ${o.region}` : ""}`}
              aria-label={`${o.seller}, ${fmtUSD(o.priceCents)}, ${o.condition}`}
              className="absolute grid -translate-x-1/2 place-items-center p-0.5"
              style={{ left: `${x * 100}%`, bottom: 2 + row * ROW_H }}
            >
              <span
                className={cn(
                  "block rounded-full transition-transform duration-150 hover:scale-125",
                  isBest ? "size-3 bg-accent ring-2 ring-accent/30" : cn("size-2", CONDITION_DOT[o.condition]),
                  (o.matched === "variant" || o.region !== "US") && !isBest && "opacity-50",
                )}
              />
            </a>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-text-muted">
        <span className="num">{fmtUSD(Math.min(...prices))}</span>
        <span className="num">{fmtUSD(Math.max(...prices))}</span>
      </div>
      <a
        href={best.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex items-center justify-between border border-border bg-accent-subtle px-3 py-2 text-xs transition-colors duration-150 hover:bg-surface-2"
      >
        <span className="truncate">
          Best · <span className="font-medium text-text">{best.seller}</span>
          {best.condition !== "new" && ` · ${best.condition}`}
        </span>
        <span className="num text-sm text-text">{fmtUSD(best.priceCents)}</span>
      </a>
    </section>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden className={cn("block size-2 rounded-full", dot)} />
      <span className="num">{label}</span>
    </span>
  );
}

type WatchState = { kind: "idle" | "saving" } | { kind: "error"; message: string };

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
          "px-4 py-2.5 text-sm font-semibold transition-[filter,background-color] duration-150",
          status?.kind === "bought" ? "bg-buy/15 text-buy" : status ? "bg-accent-subtle text-text" : "btn-gold disabled:opacity-60",
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

/** "You might also like" — nearest products in meaning from /snap's `similar` (same category). */
export function SimilarList({ products }: { products: Product[] }) {
  if (!products.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">You might also like</h3>
      <ul className="grid grid-cols-2 gap-2">
        {products.map((p) => (
          <li key={p._id} className="flex items-center gap-2 border border-border bg-surface p-2">
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" className="size-10 shrink-0 border border-border object-cover" />
            ) : (
              <div aria-hidden className="grid size-10 shrink-0 place-items-center bg-surface-2 text-[11px] font-semibold text-text-muted">
                {p.brand.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{p.title}</div>
              <div className="truncate text-[11px] text-text-muted">{p.brand}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
