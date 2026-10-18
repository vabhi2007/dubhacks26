"use client";
// Rewards — loyalty programs worth joining, valued in $/yr from the user's own merchant spend (DESIGN.md F6).
// Live from GET /rewards; Enroll → POST /rewards/:programId/enroll (simulated one-tap). Fixtures only when offline.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fmtUSD } from "@alfred/shared";
import { MoneyStat } from "@alfred/ui";
import { RewardCard } from "../../components/RewardCard";
import { type ApiError, enrollReward, getRewards, type RewardRecommendation } from "../../lib/api";

const sum = (rs: RewardRecommendation[]) => rs.reduce((a, r) => a + r.estAnnualValueCents, 0);

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">{children}</h2>;
}

export default function Rewards() {
  const [rewards, setRewards] = useState<RewardRecommendation[] | null>(null);
  const [live, setLive] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    getRewards().then((r) => {
      setRewards(r.data);
      setLive(r.live);
    });
  }, []);

  async function enroll(r: RewardRecommendation) {
    setBusyId(r.programId);
    try {
      const updated = await enrollReward(r.programId);
      setRewards((rs) => rs?.map((x) => (x.programId === r.programId ? { ...x, status: updated.status } : x)) ?? null);
      toast.success(`Joined ${r.name}${r.estAnnualValueCents ? ` — ~${fmtUSD(r.estAnnualValueCents, { compact: true })}/yr` : ""}`);
    } catch (e) {
      const err = e as ApiError;
      toast.error(err.status == null ? "Agent offline — not enrolled" : err.body || `Enroll failed (${err.status})`);
    } finally {
      setBusyId(null);
    }
  }

  const recommended = rewards?.filter((r) => r.status === "recommended") ?? [];
  const enrolled = rewards?.filter((r) => r.status === "enrolled") ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="font-serif text-[28px] tracking-tight">Rewards</h1>
      <p className="mt-1 text-sm text-text-muted">
        Programs worth joining, valued from what you already spend — no guesses for places you don&apos;t shop.
      </p>

      {rewards === null ? null : !rewards.length ? (
        <div className="mt-6 rounded-card border border-border bg-surface p-6 text-sm text-text-muted">
          Nothing worth joining yet — none of your regular merchants have a program that pays more than a few dollars a year.
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <MoneyStat
              label="Worth joining"
              cents={sum(recommended)}
              accent
              sub={`${recommended.length} program${recommended.length === 1 ? "" : "s"} you're not in yet, per year`}
            />
            <MoneyStat label="Already earning" cents={sum(enrolled)} sub={`from ${enrolled.length} program${enrolled.length === 1 ? "" : "s"}, per year`} />
          </div>

          {recommended.length ? (
            <section className="mt-8">
              <SectionLabel>Recommended</SectionLabel>
              <div className="stagger grid gap-4 sm:grid-cols-2">
                {recommended.map((r, i) => (
                  <RewardCard key={r.programId} reward={r} primary={i === 0} busy={busyId === r.programId} onEnroll={() => enroll(r)} />
                ))}
              </div>
            </section>
          ) : null}

          {enrolled.length ? (
            <section className="mt-8">
              <SectionLabel>You&apos;re in</SectionLabel>
              <div className="stagger grid gap-4 sm:grid-cols-2">
                {enrolled.map((r) => (
                  <RewardCard key={r.programId} reward={r} />
                ))}
              </div>
            </section>
          ) : null}

          {!live ? <p className="mt-6 text-xs text-text-muted">Agent offline — showing a saved example.</p> : null}
        </>
      )}
    </div>
  );
}
