// Placeholder home — Owner: D. Renders fixtures to prove tokens + shared packages are wired.
import { APP_NAME, TAGLINE, fmtUSD } from "@alfred/shared";
import { stats, verdict } from "@alfred/shared/fixtures";
import { VerdictBadge } from "@alfred/ui";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-[40px] font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="mt-2 text-text-muted">{TAGLINE}</p>

      <div className="mt-10 grid grid-cols-2 gap-4">
        <div className="rounded-card border border-border bg-surface p-6">
          <div className="text-sm text-text-muted">Saved by Alfred</div>
          <div className="num mt-1 text-[28px] text-accent">{fmtUSD(stats.savedCents)}</div>
        </div>
        <div className="rounded-card border border-border bg-surface p-6">
          <div className="text-sm text-text-muted">Rewards earned</div>
          <div className="num mt-1 text-[28px]">{fmtUSD(stats.rewardsEarnedCents)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-card border border-border bg-surface p-6">
        <VerdictBadge kind={verdict.kind} />
        <p className="mt-3 text-lg">{verdict.headline}</p>
        <ul className="mt-3 space-y-1 text-sm text-text-muted">
          {verdict.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        <button className="mt-5 rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">
          Watch for a drop
        </button>
      </div>
    </main>
  );
}
