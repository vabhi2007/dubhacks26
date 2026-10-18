"use client";
// One shared SSE connection to GET /events for the whole page (feed + savings counter +
// Home reloads): a single socket, one place to fix. Carries ONLY live events — callers show
// fixtures only when `status === "offline"`, never mixed into live data.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AgentEvent } from "@alfred/shared";
import { AGENT_URL } from "./api";

const MAX = 50;

// pending: connecting, don't know yet · live: agent reachable (show live data + empty states)
// · offline: never connected (callers may fall back to fixtures).
export type AgentStatus = "pending" | "live" | "offline";
type State = { events: AgentEvent[]; status: AgentStatus };

let state: State = { events: [], status: "pending" };
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
    // replay=0: only new events, so old purchases don't re-fire refetches.
    es = new EventSource(`${AGENT_URL}/events?replay=0`);
  } catch {
    setState({ ...state, status: "offline" });
    return;
  }
  es.addEventListener("open", () => setState({ ...state, status: "live" }));
  // The agent names its events "agent_event"; es.onmessage only gets unnamed events, so it never fires.
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
  // EventSource auto-reconnects; only call it offline if we never connected (keep live events through a blip).
  es.addEventListener("error", () => setState({ ...state, status: state.status === "live" ? "live" : "offline" }));
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

// Run a side-effect for each new live event (refetch /stats, /approvals, a verdict). Keeps the
// shared connection alive while mounted; does not re-render the caller on every event.
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
