"use client";
// The Feed page's own GET /events connection: replays the agent's backlog (?replay=200, the server's cap), then streams
// live. Kept apart from the shared replay=0 connection in useEvents so Home's refetch-on-event handlers never see
// history. The agent sends its first `ping` right after the backlog, so that marks "history loaded"; events after it
// are `fresh` (they arrived while you were watching). Dedupes by _id: EventSource resumes with Last-Event-ID.
import { useEffect, useState } from "react";
import type { AgentEvent } from "@alfred/shared";
import { AGENT_URL } from "./api";
import type { AgentStatus } from "./useEvents";

export const REPLAY = 200;
const FLUSH_MS = 50; // batch the backlog into a few renders instead of one per event
const READY_FALLBACK_MS = 3_000; // if no ping arrives, show what we have anyway

type State = {
  events: AgentEvent[]; // newest first
  status: AgentStatus;
  ready: boolean; // backlog received (or the agent is offline)
  fresh: ReadonlySet<string>; // ids that arrived live, after the backlog
};

const byNewest = (a: AgentEvent, b: AgentEvent) => new Date(b.ts).getTime() - new Date(a.ts).getTime();

export function useEventHistory(): State {
  const [state, setState] = useState<State>({ events: [], status: "pending", ready: false, fresh: new Set() });

  useEffect(() => {
    const seen = new Set<string>();
    let backlogDone = false;
    let queue: { e: AgentEvent; fresh: boolean }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;

    const flush = (ready?: boolean) => {
      clearTimeout(timer);
      timer = undefined;
      const batch = queue;
      queue = [];
      setState((s) => {
        const fresh = new Set(s.fresh);
        for (const q of batch) if (q.fresh) fresh.add(q.e._id);
        return {
          ...s,
          events: batch.length ? [...batch.map((q) => q.e), ...s.events].sort(byNewest) : s.events,
          fresh,
          ready: s.ready || Boolean(ready),
        };
      });
    };

    const es = new EventSource(`${AGENT_URL}/events?replay=${REPLAY}`);
    es.addEventListener("open", () => {
      setState((s) => ({ ...s, status: "live" }));
      fallback ??= setTimeout(() => flush(true), READY_FALLBACK_MS);
    });
    // Only "offline" if we never connected; EventSource keeps retrying through a blip.
    es.addEventListener("error", () =>
      setState((s) => (s.status === "live" ? s : { ...s, status: "offline", ready: true })),
    );
    es.addEventListener("ping", () => {
      if (backlogDone) return;
      backlogDone = true;
      clearTimeout(fallback);
      flush(true);
    });
    es.addEventListener("agent_event", (m) => {
      let e: AgentEvent;
      try {
        e = JSON.parse((m as MessageEvent<string>).data) as AgentEvent;
      } catch {
        return; // ignore malformed frame
      }
      if (!e?._id || seen.has(e._id)) return;
      seen.add(e._id);
      queue.push({ e, fresh: backlogDone });
      timer ??= setTimeout(flush, FLUSH_MS);
    });

    return () => {
      es.close();
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, []);

  return state;
}
