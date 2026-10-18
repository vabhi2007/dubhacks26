"use client";
// Spending — the 12-month profile every verdict is built on (DESIGN.md §6, GET /profile).
// Hero total + three tiles, ranked category bars, monthly trend, recurring charges, top merchants.
// Live from the agent; the offline example only when it's unreachable.
import { useEffect, useState } from "react";
import { fmtUSD } from "@alfred/shared";
import { MoneyStat, useCountUp } from "@alfred/ui";
import { CategoryDonut, categoryLabel, fullMonthAverage, MonthlyTrendChart } from "../../components/SpendingCharts";
import { getProfile, type SpendProfile } from "../../lib/api";

function SectionCard({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="enter-up border border-border bg-surface p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const CADENCE: Record<SpendProfile["recurring"][number]["cadence"], string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };

export default function Spending() {
  const [profile, setProfile] = useState<SpendProfile | null>(null);
  const [live, setLive] = useState(true);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    getProfile().then((r) => {
      setProfile(r.data);
      setLive(r.live);
    });
  }, []);

  const total = useCountUp(profile?.totals12moCents ?? 0, { duration: 900 });

  const header = (
    <>
      <h1 className="font-serif text-[28px] tracking-tight">Spending</h1>
      <p className="mt-1 text-sm text-text-muted">
        The last 12 months across your cards — what every Alfred verdict is measured against.
        {profile && !live ? " Showing an offline example." : ""}
      </p>
    </>
  );

  // Title right away; quiet placeholders in the final layout until the profile arrives (no layout jump).
  if (!profile)
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8" aria-busy="true">
        {header}
        <div className="mt-6 h-[162px] border border-border bg-surface" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[120px] border border-border bg-surface" />
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
          <div className="h-[424px] border border-border bg-surface" />
          <div className="h-[424px] border border-border bg-surface" />
        </div>
      </div>
    );

  const fullMonths = profile.byMonth.filter((m) => !m.partial);
  const avgMonthly = fullMonthAverage(profile.byMonth);
  const recurringMonthly = profile.recurring.reduce((s, r) => s + r.monthlyCents, 0);
  const top = [...profile.byCategory].sort((a, b) => b.totalCents - a.totalCents)[0];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {header}

      {/* Hero: one big number. Proportional digits read better than tabular at this size. */}
      <div className="enter-up mt-6 border border-border bg-surface p-6">
        <div className="text-sm text-text-muted">Spent in the last 12 months</div>
        <div className="num mt-2 text-[56px] font-semibold leading-none tracking-tight" style={{ fontVariantNumeric: "proportional-nums" }}>
          {fmtUSD(Math.round(total), { compact: true })}
        </div>
        <div className="mt-2 text-sm text-text-muted">{profile.txCount.toLocaleString("en-US")} transactions</div>
      </div>

      <div className="stagger mt-4 grid gap-4 sm:grid-cols-3">
        <MoneyStat label="Average month" cents={avgMonthly} sub={`${fullMonths.length} full months`} />
        <MoneyStat label="Recurring per month" cents={recurringMonthly} sub={`${profile.recurring.length} subscriptions & bills`} />
        <MoneyStat label={top ? `Top category · ${categoryLabel(top.category)}` : "Top category"} cents={top?.totalCents ?? 0} accent sub={top ? `${top.txCount} transactions` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
        <SectionCard label="By category">
          <CategoryDonut categories={profile.byCategory} totalCents={profile.totals12moCents} />
        </SectionCard>

        <SectionCard
          label="By month"
          aside={
            <span className="flex items-baseline gap-3 text-xs text-text-muted">
              <span>
                — avg <span className="num text-text">{fmtUSD(avgMonthly, { compact: true })}</span>/mo
              </span>
              <button type="button" onClick={() => setAsTable((t) => !t)} className="underline-offset-2 hover:text-text hover:underline">
                {asTable ? "Show chart" : "Show table"}
              </button>
            </span>
          }
        >
          {asTable ? (
            <table className="w-full text-sm">
              <tbody>
                {profile.byMonth.map((m) => (
                  <tr key={m.month} className="border-b border-border last:border-0">
                    <td className="py-1.5 text-text-muted">
                      {m.month}
                      {m.partial ? <span className="ml-2 text-xs">partial</span> : null}
                    </td>
                    <td className="num py-1.5 text-right">{fmtUSD(m.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <MonthlyTrendChart months={profile.byMonth} />
              <p className="mt-2 text-xs text-text-muted">Faded bars are partial months at the edges of the 12-month window.</p>
            </>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard label="Recurring" aside={<span className="num text-sm">{fmtUSD(recurringMonthly)}/mo</span>}>
          {profile.recurring.length ? (
            <ul className="stagger divide-y divide-border">
              {profile.recurring.map((r) => (
                <li key={r.merchantId} className="flex h-12 items-center justify-between gap-3 text-sm">
                  <span className="truncate">{r.merchant}</span>
                  <span className="flex items-center gap-3">
                    <span className="border border-border px-2 py-0.5 text-xs text-text-muted">{CADENCE[r.cadence]}</span>
                    <span className="num w-20 text-right">{fmtUSD(r.monthlyCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No recurring charges found.</p>
          )}
        </SectionCard>

        <SectionCard label="Top merchants">
          <ul className="stagger divide-y divide-border">
            {profile.topMerchants.slice(0, 6).map((m) => (
              <li key={m.merchantId} className="flex h-12 items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{m.merchant}</span>
                  <span className="block text-xs text-text-muted">
                    {categoryLabel(m.category)} · {m.txCount} visits
                  </span>
                </span>
                <span className="num">{fmtUSD(m.totalCents, { compact: true })}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
