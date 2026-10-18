"use client";
// Home — MVP-0 core loop surface (DESIGN.md §10). Stats, latest verdict, pending
// approvals (Approve/Deny → POST /approvals/:id), and the live Agent Feed.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Approval, Stats, Verdict } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { product as fxProduct, mandates as fxMandates, verdict as fxVerdict } from "@alfred/shared/fixtures";
import { ApprovalCard, type ApprovalState, FeedItem, MoneyStat, VerdictCard } from "@alfred/ui";
import { getLatestVerdict, getPendingApprovals, getStats, resolveApproval } from "../lib/api";
import { useEvents } from "../lib/useEvents";

// Fixture-backed lookups for display fields the approvals route doesn't inline yet.
const productTitle = (id?: string) => (id === fxProduct._id ? fxProduct.title : undefined);
const cardLast4 = (mandateId?: string) => fxMandates.find((m) => m._id === mandateId)?.card.last4;
const rewardFor = (a: Approval) =>
  a.productId === fxVerdict.productId ? fxVerdict.smartPay?.rewardCents : undefined;

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
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [states, setStates] = useState<Record<string, ApprovalState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { events } = useEvents();

  useEffect(() => {
    getStats().then((r) => setStats(r.data));
    getLatestVerdict().then((r) => setVerdict(r.data));
    getPendingApprovals().then((r) => setApprovals(r.data));
  }, []);

  async function decide(a: Approval, decision: "approve" | "deny") {
    const next: ApprovalState = decision === "approve" ? "approved" : "denied";
    setBusyId(a._id);
    setStates((s) => ({ ...s, [a._id]: next }));
    try {
      await resolveApproval(a._id, decision);
      toast.success(decision === "approve" ? `Approved ${fmtUSD(a.amountCents)}` : "Declined");
      getStats().then((r) => setStats(r.data));
    } catch {
      // Route not live yet — keep the optimistic state so the demo still reads well.
      toast.message("Agent offline — showing mock outcome", { description: `${decision} ${a.shortCode}` });
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
                product={{ title: productTitle(verdict.productId) ?? "", imageUrl: undefined }}
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
                    product={{ title: productTitle(a.productId) ?? "this purchase" }}
                    cardLast4={cardLast4(a.mandateId)}
                    rewardCents={rewardFor(a)}
                    state={states[a._id] ?? "pending"}
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
