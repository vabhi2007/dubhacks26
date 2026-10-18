// Owner: A. Fan-out of AgentEvents to every connected surface. Fed by the agent_events change stream (see changeStreams.ts).
import type { AgentEvent } from "@alfred/shared";

type Listener = (e: AgentEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function broadcast(e: AgentEvent) {
  for (const fn of listeners) fn(e);
}
