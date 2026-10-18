"use client";
// One shared SSE connection to GET /events for the whole page (feed + savings counter +
// Home reloads), so there's a single socket and one place to fix. Seeds the feed from
// fixtures, then appends live events. Falls back silently when the agent is down.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AgentEvent } from "@alfred/shared";
import { events as seedEvents } from "@alfred/shared/fixtures";
import { AGENT_URL } from "./api";

const MAX = 50;

type State = { events: AgentEvent[]; live: boolean };
let state: State = { events: [...seedEvents].reverse(), live: false };
const storeListeners = new Set<() => void>();
const eventListeners = new Set<(e: AgentEvent) => void>();
let es: EventSource | undefined;
let refCount = 0;

function setState(next: State) {
  state = next;
  storeListeners.forEach((l) => l());
}

function connect() {
  try {
    // replay=0: only new events. Backlog replay would re-fire every past purchase and spam /stats.
    es = new EventSource(`${AGENT_URL}/events?replay=0`);
  } catch {
    return;
  }
  es.addEventListener("open", () => setState({ ...state, live: true }));
  // The agent names its events "agent_event"; es.onmessage only receives unnamed events, so it never fires.
  es.addEventListener("agent_event", (ev) => {
    let e: AgentEvent;
    try {
      e = JSON.parse((ev as MessageEvent).data) as AgentEvent;
    } catch {
      return; // ignore malformed frame
    }
    setState({ ...state, events: [e, ...state.events.filter((p) => p._id !== e._id)].slice(0, MAX) });
    eventListeners.forEach((fn) => fn(e));
  });
  es.addEventListener("error", () => setState({ ...state, live: false }));
}

function acquire() {
  if (refCount++ === 0) connect();
}
function release() {
  if (--refCount === 0) {
    es?.close();
    es = undefined;
  }
}

function subscribeStore(listener: () => void) {
  storeListeners.add(listener);
  acquire();
  return () => {
    storeListeners.delete(listener);
    release();
  };
}

export function useEvents(): State {
  return useSyncExternalStore(
    subscribeStore,
    () => state,
    () => state,
  );
}

// Run a side-effect for each new live event (e.g. refetch /stats or /approvals). Keeps the
// shared connection alive while mounted and does not re-render the caller on every event.
export function useAgentEvent(handler: (e: AgentEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    acquire();
    const fn = (e: AgentEvent) => ref.current(e);
    eventListeners.add(fn);
    return () => {
      eventListeners.delete(fn);
      release();
    };
  }, []);
}
