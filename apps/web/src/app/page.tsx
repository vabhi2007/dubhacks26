"use client";
// Home — MVP-0 core loop surface (DESIGN.md §10). Stats, latest verdict, pending
// approvals (Approve/Deny → POST /approvals/:id), and the live Agent Feed.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentEvent, Stats, Verdict } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { product as fxProduct } from "@alfred/shared/fixtures";
import { ApprovalCard, type ApprovalState, FeedItem, MoneyStat, VerdictCard } from "@alfred/ui";
import {
  type ApiError,
  type ApprovalView,
  getLatestVerdict,
  getPendingApprovals,
  getStats,
  resolveApproval,
} from "../lib/api";
import { useAgentEvent, useEvents } from "../lib/useEvents";

// Events that change the stats/approvals the demo watches — including the reset's "message".
const RELOAD_ON = new Set<AgentEvent["type"]>(["approval_requested", "approval_resolved", "purchase", "message"]);

const verdictProductTitle = (id?: string) => (id === fxProduct._id ? fxProduct.title : undefined);

function CountStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="text-sm text-text-muted">{label}</div>
      <div className="num mt-1.5 text-[28px] leading-none tracking-tight">{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">{children}</h2>;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [states, setStates] = useState<Record<string, ApprovalState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { events } = useEvents();

  const statesRef = useRef(states);
  statesRef.current = states;

  const reloadStats = useCallback(() => {
    getStats().then((r) => setStats(r.data));
  }, []);
  const reloadApprovals = useCallback(() => {
    getPendingApprovals().then((r) => {
      setApprovals((prev) => {
        // Keep approvals we've already resolved locally so their Receipt stays visible after
        // they drop out of the pending list.
        const resolvedShown = prev.filter((a) => statesRef.current[a._id] && !r.data.some((n) => n._id === a._id));
        return [...resolvedShown, ...r.data];
      });
    });
  }, []);

  useEffect(() => {
    reloadStats();
    reloadApprovals();
    getLatestVerdict().then((r) => setVerdict(r.data));
  }, [reloadStats, reloadApprovals]);

  // Scripted demo: /admin price drop → approval_requested → the approval appears here without a
  // manual refresh; approve → approval_resolved/purchase → stats + feed update live.
  useAgentEvent((e) => {
    if (!RELOAD_ON.has(e.type)) return;
    reloadStats();
    reloadApprovals();
  });

  async function decide(a: ApprovalView, decision: "approve" | "deny") {
    const next: ApprovalState = decision === "approve" ? "approved" : "denied";
    setBusyId(a._id);
    setStates((s) => ({ ...s, [a._id]: next }));
    try {
      await resolveApproval(a._id, decision);
      toast.success(decision === "approve" ? `Approved ${fmtUSD(a.amountCents)}` : "Declined");
      reloadStats();
    } catch (err) {
      const { status, body } = err as ApiError;
      if (status == null) {
        // No response at all → agent offline. Keep the optimistic outcome so the demo still reads.
        toast.message("Agent offline — showing mock outcome", { description: `${decision} ${a.shortCode}` });
      } else {
        // The agent answered with an error (e.g. 409 expired). Undo the optimistic receipt and surface it.
        setStates((s) => {
          const n = { ...s };
          delete n[a._id];
          return n;
        });
        toast.error(`Couldn't ${decision} ${a.shortCode} — ${body || `error ${status}`}`);
        reloadApprovals();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">Home</h1>
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
                product={{ title: verdictProductTitle(verdict.productId) ?? "", imageUrl: undefined }}
                actions={
                  <button
                    type="button"
                    onClick={() => toast.success("Watching for a price drop")}
                    className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                  >
                    Watch for a drop
                  </button>
                }
              />
            ) : null}
          </section>

          <section>
            <SectionLabel>Pending approvals</SectionLabel>
            {approvals.length ? (
              <div className="space-y-3">
                {approvals.map((a) => (
                  <ApprovalCard
                    key={a._id}
                    approval={a}
                    product={{ title: a.product?.title ?? "this purchase" }}
                    cardBrand={a.cardBrand}
                    cardLast4={a.cardLast4}
                    rewardCents={a.rewardCents}
                    state={states[a._id]}
                    busy={busyId === a._id}
                    onApprove={() => decide(a, "approve")}
                    onDeny={() => decide(a, "deny")}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-border bg-surface p-6 text-sm text-text-muted">
                No approvals waiting on you.
              </div>
            )}
          </section>
        </div>

        <section className="lg:col-span-1">
          <SectionLabel>Agent feed</SectionLabel>
          <div className="rounded-card border border-border bg-surface px-5 py-1">
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <FeedItem key={e._id} event={e} />
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
