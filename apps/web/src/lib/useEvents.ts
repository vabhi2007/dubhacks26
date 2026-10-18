"use client";
// Live Agent Feed over GET /events (SSE). Seeds from fixtures so the feed is never
// empty, then prepends real events as they arrive. Falls back silently when the
// agent service is down.
import { useEffect, useState } from "react";
import type { AgentEvent } from "@alfred/shared";
import { events as seedEvents } from "@alfred/shared/fixtures";
import { AGENT_URL } from "./api";

const MAX = 50;

export function useEvents(): { events: AgentEvent[]; live: boolean } {
  const [events, setEvents] = useState<AgentEvent[]>(() => [...seedEvents].reverse());
  const [live, setLive] = useState(false);

  useEffect(() => {
    let es: EventSource;
    try {
      es = new EventSource(`${AGENT_URL}/events`);
    } catch {
      return;
    }
    es.onopen = () => setLive(true);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as AgentEvent;
        setEvents((prev) => [evt, ...prev.filter((p) => p._id !== evt._id)].slice(0, MAX));
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  return { events, live };
}
