"use client";
// One shared minute clock for every relative-time label on the page (one timer, not one per row).
// Returns null on the server and during hydration, so callers can render a deterministic placeholder.
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let now: Date | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    // React re-reads the snapshot right after subscribing, so this first value lands immediately.
    now = new Date();
    timer = setInterval(() => {
      now = new Date();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow(): Date | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}
