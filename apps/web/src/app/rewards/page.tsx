"use client";
// Rewards — loyalty programs worth joining, valued in $/yr from the user's own merchant spend (DESIGN.md F6).
// Live from GET /rewards. "Join" opens the program's sign-up page in a new tab; when the user comes back to this tab we
// ask whether they actually joined, and only a "yes" records it (POST /rewards/:programId/enroll). Fixtures when offline.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fmtUSD } from "@alfred/shared";
import { MoneyStat } from "@alfred/ui";
import { RewardCard } from "../../components/RewardCard";
import { EnrollConfirmDialog } from "../../components/EnrollConfirmDialog";
import { type ApiError, enrollReward, getRewards, type RewardRecommendation } from "../../lib/api";

const sum = (rs: RewardRecommendation[]) => rs.reduce((a, r) => a + r.estAnnualValueCents, 0);

/** A sign-up we sent the user to and haven't heard back about. Kept in sessionStorage so a reload still asks. */
type Pending = { programId: string; name: string; url: string; openedAt: number };
const PENDING_KEY = "alfred:pendingEnroll";
const readPending = (): Pending | null => {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as Pending | null;
  } catch {
    return null;
  }
};
/** Called from the Join click handler (kept outside the component: it reads the clock). */
const newPending = (r: RewardRecommendation): Pending => ({ programId: r.programId, name: r.name, url: r.enrollUrl, openedAt: Date.now() });
const writePending = (p: Pending | null) => {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // storage unavailable (private mode): the question just won't survive a reload
  }
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">{children}</h2>;
}

export default function Rewards() {
  const [rewards, setRewards] = useState<RewardRecommendation[] | null>(null);
  const [live, setLive] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [asking, setAsking] = useState<Pending | null>(null);
  const pending = useRef<Pending | null>(null);

  useEffect(() => {
    getRewards().then((r) => {
      setRewards(r.data);
      setLive(r.live);
    });
  }, []);

  // Back on this tab after visiting a sign-up page (or reloaded with one pending) → ask whether they joined.
  const onReturn = useCallback(() => {
    const p = pending.current ?? readPending();
    if (!p || document.visibilityState !== "visible" || Date.now() - p.openedAt < 800) return;
    pending.current = p;
    setAsking(p);
  }, []);

  useEffect(() => {
    const restore = setTimeout(onReturn, 0); // a reload with a sign-up pending
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearTimeout(restore);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [onReturn]);

  function join(r: RewardRecommendation) {
    const p = newPending(r);
    pending.current = p;
    writePending(p);
    window.open(r.enrollUrl, "_blank", "noopener,noreferrer");
    // If the new tab never took focus (pop-up blocked), ask right away — the dialog has an "Open it again" link.
    setTimeout(() => {
      if (pending.current === p && document.visibilityState === "visible" && document.hasFocus()) setAsking(p);
    }, 1500);
  }

  const clearPending = () => {
    pending.current = null;
    writePending(null);
    setAsking(null);
  };

  async function confirmJoined(p: Pending) {
    setBusyId(p.programId);
    try {
      const updated = await enrollReward(p.programId);
      const est = rewards?.find((x) => x.programId === p.programId)?.estAnnualValueCents ?? 0;
      setRewards((rs) => rs?.map((x) => (x.programId === p.programId ? { ...x, status: updated.status } : x)) ?? null);
      toast.success(`Joined ${p.name}${est ? ` — ~${fmtUSD(est, { compact: true })}/yr` : ""}`);
      clearPending();
    } catch (e) {
      const err = e as ApiError;
      toast.error(err.status == null ? "Agent offline — couldn't save that" : err.body || `Couldn't save (${err.status})`);
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
                  <RewardCard key={r.programId} reward={r} primary={i === 0} busy={busyId === r.programId} onEnroll={() => join(r)} />
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

      {asking ? (
        <EnrollConfirmDialog
          name={asking.name}
          url={asking.url}
          busy={busyId === asking.programId}
          onYes={() => void confirmJoined(asking)}
          onNo={clearPending}
        />
      ) : null}
    </div>
  );
}
