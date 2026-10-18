"use client";
// Header savings counter. Fetches /stats (fixture fallback) and re-pulls when money moves,
// via the shared /events connection. Count-up tick animation is part of the MVP-3 motion pass.
import { useEffect, useState } from "react";
import type { AgentEvent, Stats } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { getStats } from "../lib/api";
import { useAgentEvent, useEvents } from "../lib/useEvents";

const REFETCH_ON = new Set<AgentEvent["type"]>(["purchase", "approval_resolved"]);

export function SavingsCounter() {
  const [stats, setStats] = useState<Stats | null>(null);
  const { live } = useEvents();

  useEffect(() => {
    let active = true;
    getStats().then((r) => active && setStats(r.data));
    return () => {
      active = false;
    };
  }, []);

  useAgentEvent((e) => {
    if (REFETCH_ON.has(e.type)) getStats().then((r) => setStats(r.data));
  });

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
