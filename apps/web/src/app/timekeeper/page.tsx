"use client";
// Timekeeper — "upgrade now vs wait N months" for the user's phone (DESIGN.md F8, T-Mobile).
// Live from GET /timekeeper (verdict + trade-in series); the fixture verdict only when the agent is offline.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import type { Verdict } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { fade, MoneyStat, VerdictCard } from "@alfred/ui";
import { TimekeeperChart } from "../../components/TimekeeperChart";
import { getProductInfo, getTimekeeper } from "../../lib/api";

// The fixture's iPhone 17 isn't in the fixture catalog, so name it for the offline view.
const OFFLINE_TITLES: Record<string, string> = { prd_iphone17: "Apple iPhone 17 256GB" };

/** Verdict + the upgrade target's title. No state here, so the effect and Re-check can share it. */
async function fetchTimekeeper(refresh: boolean) {
  const r = await getTimekeeper(refresh);
  const info = r.live ? await getProductInfo(r.data.productId) : null;
  return { verdict: r.data, live: r.live, title: info?.title ?? OFFLINE_TITLES[r.data.productId] };
}

export default function Timekeeper() {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [live, setLive] = useState(true);
  const [title, setTitle] = useState<string>();
  const [checking, setChecking] = useState(false);
  const reduce = useReducedMotion();

  const show = (r: Awaited<ReturnType<typeof fetchTimekeeper>>) => {
    setVerdict(r.verdict);
    setLive(r.live);
    setTitle(r.title);
  };

  useEffect(() => {
    let gone = false;
    fetchTimekeeper(false).then((r) => !gone && show(r));
    return () => {
      gone = true;
    };
  }, []);

  async function recheck() {
    setChecking(true);
    try {
      const r = await fetchTimekeeper(true);
      show(r);
      if (!r.live) toast.error("Agent offline — showing the saved example");
    } finally {
      setChecking(false);
    }
  }

  const tk = verdict?.timekeeper;
  const wait = tk?.waitMonths ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="font-serif text-[28px] tracking-tight">Timekeeper</h1>
      <p className="mt-1 text-sm text-text-muted">
        When to upgrade your phone — from your trade-in value, what you still owe, and how your battery is holding up.
      </p>

      {!verdict ? null : !tk ? (
        <div className="mt-6 rounded-card border border-border bg-surface p-6 text-sm text-text-muted">
          No phone on file yet, so there&apos;s nothing to time.
        </div>
      ) : (
        // Re-keyed per verdict so a re-check fades the new answer in (state change only; fade-only under reduced motion).
        <motion.div
          key={verdict._id}
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={fade}
          className="mt-6 space-y-4"
        >
          <VerdictCard
            verdict={verdict}
            product={title ? { title } : undefined}
            actions={
              <button
                type="button"
                onClick={recheck}
                disabled={checking}
                className="rounded-control border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {checking ? "Checking…" : "Re-check"}
              </button>
            }
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <MoneyStat label="Upgrade today" cents={tk.costNowCents} sub="out of pocket, incl. what you still owe" />
            {wait > 0 ? (
              <>
                <MoneyStat label={`Upgrade in ${wait} month${wait === 1 ? "" : "s"}`} cents={tk.costLaterCents} sub="out of pocket" />
                <MoneyStat label="Saved by waiting" cents={tk.costNowCents - tk.costLaterCents} accent />
              </>
            ) : (
              <div className="rounded-card border border-border bg-surface p-5 text-sm text-text-muted sm:col-span-2">
                Waiting only costs you more from here — your trade-in keeps dropping.
              </div>
            )}
          </div>

          <div className="rounded-card border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">Trade-in value</h2>
              {tk.tradeInSeries[0] ? (
                <span className="text-sm text-text-muted">
                  <span className="num text-text">{fmtUSD(tk.tradeInSeries[0].valueCents)}</span> today
                  {wait > 0 && tk.tradeInSeries.find((p) => p.month === wait) ? (
                    <>
                      {" · "}
                      <span className="num text-accent">{fmtUSD(tk.tradeInSeries.find((p) => p.month === wait)!.valueCents)}</span> in {wait}mo
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
            <TimekeeperChart className="mt-3 h-64" series={tk.tradeInSeries} waitMonths={wait} />
          </div>

          {!live ? <p className="text-xs text-text-muted">Agent offline — showing a saved example.</p> : null}
        </motion.div>
      )}
    </div>
  );
}
