"use client";
// Home — MVP-0 core loop surface (DESIGN.md §10). Stats, latest verdict, pending
// approvals (Approve/Deny → POST /approvals/:id), receipts, and the live Agent Feed.
// When the agent is reachable we show ONLY its data (with empty states); fixtures are a
// fallback purely for when it's unreachable, never mixed into live data.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { AgentEvent, Stats, Verdict } from "@alfred/shared";
import { fmtUSD, watchTarget } from "@alfred/shared";
import { events as fxEvents, product as fxProduct, verdict as fxVerdict } from "@alfred/shared/fixtures";
import { ApprovalCard, type ApprovalState, FeedItem, MoneyStat, useCountUp, VerdictCard } from "@alfred/ui";
import {
  type ApiError,
  type ApprovalView,
  type VerdictView,
  type WatchView,
  createWatch,
  getApprovals,
  getLatestVerdict,
  getStats,
  getVerdict,
  getWishlist,
  resolveApproval,
} from "../lib/api";
import { useAgentEvent, useEvents } from "../lib/useEvents";
import { useEventHistory } from "../lib/useEventHistory";
import { VerdictGraphs } from "../components/VerdictGraphs";

// Anything that moves money / changes stats or approvals (reset emits "message").
const APPROVAL_EVENTS = new Set<AgentEvent["type"]>(["approval_requested", "approval_resolved", "purchase", "message"]);
// Anything that changes a product's watch/purchase state.
const WATCH_EVENTS = new Set<AgentEvent["type"]>(["watch_created", "price_drop", "approval_resolved", "purchase", "message"]);

const fixtureFeed = [...fxEvents].reverse();
const verdictProductTitle = (id?: string) => (id === fxProduct._id ? fxProduct.title : undefined);
const resolvedDesc = (a: ApprovalView, b: ApprovalView) =>
  new Date(b.resolvedAt ?? 0).getTime() - new Date(a.resolvedAt ?? 0).getTime();

function CountStat({ label, value }: { label: string; value: number }) {
  const shown = useCountUp(value);
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="text-sm text-text-muted">{label}</div>
      <div className="num mt-1.5 text-[28px] leading-none tracking-tight">{Math.round(shown)}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">{children}</h2>;
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-border bg-surface p-6 text-sm text-text-muted">{children}</div>;
}

// A non-interactive status pill used for the Latest Verdict CTA once a watch/purchase exists.
function StatePill({ children, tone }: { children: React.ReactNode; tone: "accent" | "buy" }) {
  const cls = tone === "buy" ? "text-buy bg-buy/10" : "text-accent bg-accent-subtle";
  return <span className={`inline-flex items-center rounded-control px-4 py-2 text-sm font-medium ${cls}`}>{children}</span>;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [liveVerdict, setLiveVerdict] = useState<VerdictView | null>(null);
  const [pending, setPending] = useState<ApprovalView[]>([]);
  const [receipts, setReceipts] = useState<ApprovalView[]>([]);
  const [wishlist, setWishlist] = useState<WatchView[]>([]);
  const [resolvedLocal, setResolvedLocal] = useState<Record<string, ApprovalState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { status } = useEvents();
  // The list shows recent history too (backlog + live); refetch handlers stay on the live-only stream above.
  const history = useEventHistory();

  const offline = status === "offline";

  const reloadStats = useCallback(() => getStats().then((r) => setStats(r.data)), []);
  const reloadPending = useCallback(() => getApprovals("pending").then((r) => setPending(r.data)), []);
  const reloadReceipts = useCallback(
    () => getApprovals("approved").then((r) => setReceipts([...r.data].sort(resolvedDesc).slice(0, 4))),
    [],
  );
  const reloadWishlist = useCallback(() => getWishlist().then((r) => setWishlist(r.data)), []);

  useEffect(() => {
    reloadStats();
    reloadPending();
    reloadReceipts();
    reloadWishlist();
    // Latest verdict on first load; live `verdict` events keep it fresh below.
    getLatestVerdict().then((v) => v && setLiveVerdict(v));
  }, [reloadStats, reloadPending, reloadReceipts, reloadWishlist]);

  // Scripted demo: price drop → approval_requested → approval appears; a YES on ANY channel
  // (web / iMessage / voice) → approval_resolved + purchase → a Receipt shows here and the
  // verdict CTA flips to Bought, regardless of where it was approved.
  useAgentEvent((e) => {
    if (APPROVAL_EVENTS.has(e.type)) {
      reloadStats();
      reloadPending();
      reloadReceipts();
    }
    if (WATCH_EVENTS.has(e.type)) reloadWishlist();
    if (e.type === "verdict" && e.refs.verdictId) {
      getVerdict(e.refs.verdictId).then((v) => v && setLiveVerdict(v));
    }
  });

  async function decide(a: ApprovalView, decision: "approve" | "deny") {
    const next: ApprovalState = decision === "approve" ? "approved" : "denied";
    setBusyId(a._id);
    setResolvedLocal((s) => ({ ...s, [a._id]: next })); // instant morph for the web click
    try {
      await resolveApproval(a._id, decision);
      toast.success(decision === "approve" ? `Approved ${fmtUSD(a.amountCents)}` : "Declined");
      reloadStats();
      reloadReceipts();
      reloadPending();
      reloadWishlist();
    } catch (err) {
      const { status: code, body } = err as ApiError;
      if (code == null) {
        // No response → agent offline. Keep the optimistic outcome so the demo still reads.
        toast.message("Agent offline — showing mock outcome", { description: `${decision} ${a.shortCode}` });
      } else {
        // The agent refused (e.g. 409 expired). Undo the optimistic state and surface it.
        setResolvedLocal((s) => {
          const n = { ...s };
          delete n[a._id];
          return n;
        });
        toast.error(`Couldn't ${decision} ${a.shortCode} — ${body || `error ${code}`}`);
        reloadPending();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function watch(v: Verdict) {
    const target = watchTarget(v.math.priceCents, v.math.expectedDropCents);
    if (target === undefined) {
      toast.error("No sensible watch target for this price");
      return;
    }
    try {
      await createWatch(v.productId, target);
      toast.success(`Watching — buys at ${fmtUSD(target)}`);
      reloadWishlist();
    } catch (err) {
      const { status: code, body } = err as ApiError;
      toast.error(code == null ? "Agent offline — not watching" : body || `Couldn't watch (${code})`);
    }
  }

  // Fixtures only when the agent is unreachable; otherwise live data (possibly empty).
  const feed = offline ? fixtureFeed : history.events.slice(0, 8);
  const verdict: VerdictView | null = offline ? fxVerdict : liveVerdict;

  // Receipts to show: fetched resolved approvals, minus any still in the pending list.
  const shownReceipts = receipts.filter((r) => !pending.some((p) => p._id === r._id));

  // Latest Verdict CTA reflects the product's state: Bought > Watching > Watch for a drop.
  const vpid = verdict?.productId;
  const bought = vpid ? receipts.find((r) => r.productId === vpid && r.kind !== "enroll") : undefined;
  const watching = vpid
    ? wishlist.find((w) => w.productId === vpid && (w.status === "watching" || w.status === "triggered"))
    : undefined;
  // A Timekeeper verdict is about when to upgrade, not a price drop — link to its page instead of offering a watch.
  const verdictCta = !verdict ? null : verdict.mode === "timekeeper" ? (
    <Link href="/timekeeper" className="rounded-control border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2">
      See the upgrade plan
    </Link>
  ) : bought ? (
    <StatePill tone="buy">
      Bought for {fmtUSD(bought.amountCents)}
      {bought.cardLast4 ? ` on ••${bought.cardLast4}` : ""}
    </StatePill>
  ) : watching ? (
    <StatePill tone="accent">Watching — buys at {fmtUSD(watching.targetPriceCents)}</StatePill>
  ) : (
    <button
      type="button"
      onClick={() => watch(verdict)}
      className="btn-gold rounded-control px-4 py-2 text-sm font-medium transition-[filter]"
    >
      Watch for a drop
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <h1 className="font-serif text-[28px] tracking-tight">Home</h1>
      <p className="mt-1 text-sm text-text-muted">What Alfred has been doing with your money.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MoneyStat label="Saved by Alfred" cents={stats?.savedCents ?? 0} accent />
        <MoneyStat label="Rewards earned" cents={stats?.rewardsEarnedCents ?? 0} />
        <CountStat label="Purchases" value={stats?.purchases ?? 0} />
        <CountStat label="Active watches" value={stats?.activeWatches ?? 0} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section>
            <SectionLabel>Latest verdict</SectionLabel>
            {verdict ? (
              <VerdictCard
                verdict={verdict}
                product={{ title: verdict.product?.title ?? verdictProductTitle(verdict.productId) ?? "", imageUrl: verdict.product?.imageUrl }}
                actions={verdictCta}
                details={<VerdictGraphs verdict={verdict} />}
              />
            ) : (
              <EmptyCard>No verdict yet — snap a product or ask Alfred whether something&rsquo;s worth it.</EmptyCard>
            )}
          </section>

          <section>
            <SectionLabel>Pending approvals</SectionLabel>
            {pending.length ? (
              <div className="stagger space-y-3">
                {pending.map((a) => (
                  <ApprovalCard
                    key={a._id}
                    approval={a}
                    product={{ title: a.product?.title ?? "this purchase" }}
                    cardBrand={a.cardBrand}
                    cardLast4={a.cardLast4}
                    rewardCents={a.rewardCents}
                    state={resolvedLocal[a._id]}
                    busy={busyId === a._id}
                    onApprove={() => decide(a, "approve")}
                    onDeny={() => decide(a, "deny")}
                  />
                ))}
              </div>
            ) : (
              <EmptyCard>No approvals waiting on you.</EmptyCard>
            )}
          </section>

          {shownReceipts.length ? (
            <section>
              <SectionLabel>Recent</SectionLabel>
              <div className="space-y-3">
                {shownReceipts.map((r) => (
                  <ApprovalCard
                    key={r._id}
                    approval={r}
                    product={{ title: r.product?.title ?? "this purchase" }}
                    cardBrand={r.cardBrand}
                    cardLast4={r.cardLast4}
                    rewardCents={r.rewardCents}
                    state="approved"
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <section className="lg:col-span-1">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Agent feed</SectionLabel>
            <Link href="/feed" className="text-xs text-text-muted transition-colors hover:text-text">
              All activity ›
            </Link>
          </div>
          <div className="rounded-card border border-border bg-surface px-5 py-1">
            {feed.length ? (
              <ul className="stagger divide-y divide-border">
                {feed.map((e) => (
                  <FeedItem key={e._id} event={e} />
                ))}
              </ul>
            ) : (
              <p className="py-4 text-sm text-text-muted">No activity yet. Alfred&rsquo;s actions will show up here.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
