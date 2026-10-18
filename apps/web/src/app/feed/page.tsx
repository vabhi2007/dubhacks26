"use client";
// Agent Feed — everything Alfred did, on every surface (DESIGN.md §1, §6). The /events backlog plus live events,
// grouped by day, filterable by agent and surface (?agent=watcher&surface=imessage, so a filtered view is linkable).
// Fixture events only when the agent is unreachable, never mixed into live data.
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AgentName, Surface, type AgentEvent } from "@alfred/shared";
import { events as fxEvents } from "@alfred/shared/fixtures";
import { AGENT_LABEL, FeedItem, SURFACE_LABEL, cn, useNow } from "@alfred/ui";
import { REPLAY, useEventHistory } from "../../lib/useEventHistory";

const fixtureFeed = [...fxEvents].reverse();
const DAY_MS = 86_400_000;

type Filters = { agent: AgentName | null; surface: Surface | null };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function dayLabel(d: Date, now: Date | null) {
  if (now) {
    const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
  }
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Newest-first events → [{ key, label, events }] by local day.
function byDay(events: AgentEvent[], now: Date | null) {
  const groups: { key: string; label: string; events: AgentEvent[] }[] = [];
  for (const e of events) {
    const d = new Date(e.ts);
    const key = d.toDateString();
    const last = groups.at(-1);
    if (last?.key === key) last.events.push(e);
    else groups.push({ key, label: dayLabel(d, now), events: [e] });
  }
  return groups;
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs transition-colors",
        active ? "border-accent/40 bg-accent-subtle text-accent" : "border-border text-text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      {label}
      <span className={cn("num", active ? "text-accent" : "text-text-muted/70")}>{count}</span>
    </button>
  );
}

// One facet row. Counts respect the *other* facet, so the numbers always match what a click would show.
function FacetRow<K extends string>({
  title,
  options,
  labels,
  counts,
  total,
  value,
  onChange,
}: {
  title: string;
  options: readonly K[];
  labels: Record<K, string>;
  counts: Map<K, number>;
  total: number;
  value: K | null;
  onChange: (v: K | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</span>
      <Chip label="All" count={total} active={value === null} onClick={() => onChange(null)} />
      {options
        .filter((o) => (counts.get(o) ?? 0) > 0 || o === value)
        .map((o) => (
          <Chip
            key={o}
            label={labels[o]}
            count={counts.get(o) ?? 0}
            active={value === o}
            onClick={() => onChange(value === o ? null : o)}
          />
        ))}
    </div>
  );
}

function countBy<K>(events: AgentEvent[], key: (e: AgentEvent) => K) {
  const m = new Map<K, number>();
  for (const e of events) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
  return m;
}

function Feed() {
  const { events, status, ready, fresh } = useEventHistory();
  const params = useSearchParams();
  const pathname = usePathname();
  const now = useNow();

  const filters: Filters = {
    agent: AgentName.safeParse(params.get("agent")).data ?? null,
    surface: Surface.safeParse(params.get("surface")).data ?? null,
  };

  // Native history updates integrate with useSearchParams (no navigation, no refetch).
  function setFilter(key: keyof Filters, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  const offline = status === "offline";
  const all = offline ? fixtureFeed : events;
  const bySurface = filters.surface ? all.filter((e) => e.surface === filters.surface) : all;
  const byAgent = filters.agent ? all.filter((e) => e.agent === filters.agent) : all;
  const shown = filters.agent ? bySurface.filter((e) => e.agent === filters.agent) : bySurface;
  const filtering = filters.agent !== null || filters.surface !== null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[28px] tracking-tight">Agent Feed</h1>
          <p className="mt-1 text-sm text-text-muted">Everything Alfred has done, on every surface.</p>
        </div>
        {ready ? (
          <div className="text-right text-sm text-text-muted">
            <span className="num text-[20px] leading-none text-text">{shown.length}</span>
            {filtering ? <> of <span className="num">{all.length}</span></> : null} {all.length === 1 ? "event" : "events"}
          </div>
        ) : null}
      </div>

      {!ready ? null : (
        <>
          <div className="mt-6 space-y-2.5">
            <FacetRow
              title="Agent"
              options={AgentName.options}
              labels={AGENT_LABEL}
              counts={countBy(bySurface, (e) => e.agent)}
              total={bySurface.length}
              value={filters.agent}
              onChange={(v) => setFilter("agent", v)}
            />
            <FacetRow
              title="Surface"
              options={Surface.options}
              labels={SURFACE_LABEL}
              counts={countBy(byAgent, (e) => e.surface)}
              total={byAgent.length}
              value={filters.surface}
              onChange={(v) => setFilter("surface", v)}
            />
          </div>

          {offline ? (
            <p className="mt-4 text-xs text-text-muted">Agent offline — showing sample activity.</p>
          ) : null}

          {shown.length ? (
            <div className="mt-6 space-y-6">
              {byDay(shown, now).map((g) => (
                <section key={g.key}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">{g.label}</h2>
                    <span className="num text-xs text-text-muted">{g.events.length}</span>
                  </div>
                  <div className="rounded-card border border-border bg-surface px-5 py-1">
                    <ul className="divide-y divide-border">
                      {g.events.map((e) => (
                        <FeedItem key={e._id} event={e} className={fresh.has(e._id) ? "feed-in" : undefined} />
                      ))}
                    </ul>
                  </div>
                </section>
              ))}
              {!offline && events.length >= REPLAY ? (
                <p className="text-center text-xs text-text-muted">Showing the latest {REPLAY} events.</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-6 rounded-card border border-border bg-surface p-6 text-sm text-text-muted">
              {filtering ? (
                <>
                  Nothing here for these filters.{" "}
                  <button
                    type="button"
                    onClick={() => window.history.replaceState(null, "", pathname)}
                    className="text-text underline-offset-4 hover:underline"
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                "No activity yet. Alfred’s actions will show up here."
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary so the rest of the route can prerender.
export default function FeedPage() {
  return (
    <Suspense fallback={null}>
      <Feed />
    </Suspense>
  );
}
