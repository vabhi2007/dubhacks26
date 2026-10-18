// Owner: C. One live connection to the agent's /events for the whole panel. It replays the last few events (for the
// "Recent activity" list), then streams new ones. Subscribers hear every event with a `live` flag, so state machines
// like the watch status can ignore the replayed history.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@alfred/shared";

const REPLAY = 10;
const KEEP = 20;
const REPLAY_GRACE_MS = 2_000; // events stamped before the connection opened (minus clock jitter) are history

export type EventListener = (e: AgentEvent, live: boolean) => void;

export function useAgentEvents(agentUrl: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]); // newest first
  const listeners = useRef(new Set<EventListener>());

  useEffect(() => {
    const openedAt = Date.now();
    const seen = new Set<string>(); // EventSource reconnects with Last-Event-ID; never apply an event twice
    const es = new EventSource(`${agentUrl}/events?replay=${REPLAY}`);
    es.addEventListener("agent_event", (m) => {
      let e: AgentEvent;
      try {
        e = JSON.parse((m as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (!e?._id || seen.has(e._id)) return;
      seen.add(e._id);
      const live = new Date(e.ts).getTime() >= openedAt - REPLAY_GRACE_MS;
      setEvents((prev) => [e, ...prev].sort((a, b) => +new Date(b.ts) - +new Date(a.ts)).slice(0, KEEP));
      for (const l of listeners.current) l(e, live);
    });
    return () => es.close();
  }, [agentUrl]);

  const subscribe = useCallback((l: EventListener) => {
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);

  return { events, subscribe };
}
