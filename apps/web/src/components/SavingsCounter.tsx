"use client";
// Header savings counter. Fetches /stats (fixture fallback) and re-pulls when a
// money-moving event lands on the SSE stream so the demo number stays live.
// The count-up tick animation is part of the MVP-3 motion pass.
import { useEffect, useState } from "react";
import type { AgentEvent, Stats } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { AGENT_URL, getStats } from "../lib/api";

const REFETCH_ON = new Set<AgentEvent["type"]>(["purchase", "approval_resolved", "price_drop"]);

export function SavingsCounter() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;
    const pull = () => getStats().then((r) => active && setStats(r.data));
    pull();

    let es: EventSource | undefined;
    try {
      es = new EventSource(`${AGENT_URL}/events`);
      es.onopen = () => active && setLive(true);
      es.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data) as AgentEvent;
          if (REFETCH_ON.has(evt.type)) pull();
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => active && setLive(false);
    } catch {
      /* no stream */
    }

    return () => {
      active = false;
      es?.close();
    };
  }, []);

  return (
    <div className="flex items-center gap-3">
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "bg-buy" : "bg-text-muted/40"}`}
        title={live ? "Live — connected to agent" : "Mock — using fixtures"}
      />
      <div className="text-right">
        <div className="text-[11px] uppercase tracking-wide text-text-muted">Saved by Alfred</div>
        <div className="num text-[20px] leading-none text-accent">
          {stats ? fmtUSD(stats.savedCents) : "—"}
        </div>
      </div>
    </div>
  );
}
