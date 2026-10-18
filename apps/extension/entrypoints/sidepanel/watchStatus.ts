// Owner: C. Live watch status for the product on screen (#38): GET /wishlist once, then the panel's /events stream, so
// the panel follows Watch → price drop → approval → purchase instead of saying "Watching" forever.
import { useEffect, useState } from "react";
import type { AgentEvent, WishlistItem } from "@alfred/shared";
import type { EventListener } from "./agentEvents";

export type WatchStatus = { kind: "watching" | "approval" | "bought"; note?: string };

export const statusFromItem = (s: WishlistItem["status"]): WatchStatus | null =>
  s === "watching" ? { kind: "watching" } : s === "triggered" ? { kind: "approval" } : s === "bought" ? { kind: "bought" } : null;

/** How an event for this product changes the status; undefined = leave it (a price drop only updates the note). */
export function nextStatus(e: AgentEvent, prev: WatchStatus | null): WatchStatus | null | undefined {
  switch (e.type) {
    case "watch_created":
      return { kind: "watching", note: e.summary };
    case "price_drop":
      return prev ? { ...prev, note: e.summary } : undefined;
    case "approval_requested":
      return { kind: "approval", note: e.summary };
    case "approval_resolved":
      // An approval is followed by a `purchase` event; a NO puts the watch back to watching.
      return /declined|denied/i.test(e.summary) ? { kind: "watching", note: e.summary } : undefined;
    case "purchase":
      return { kind: "bought", note: e.summary };
    default:
      return undefined;
  }
}

/** `subscribe` is the panel's shared /events stream (agentEvents.ts); only live events move the status. */
export function useWatchStatus(agentUrl: string, productId: string | undefined, subscribe: (l: EventListener) => () => void) {
  const [status, setStatus] = useState<WatchStatus | null>(null);

  useEffect(() => {
    setStatus(null);
    if (!productId) return;
    let active = true;

    // A watch that already fired before the panel opened (or while it was closed).
    fetch(`${agentUrl}/wishlist`)
      .then((r) => (r.ok ? r.json() : []))
      .then((items: WishlistItem[]) => {
        const mine = items.filter((i) => i.productId === productId && i.status !== "cancelled").at(-1);
        if (active && mine) setStatus((s) => s ?? statusFromItem(mine.status));
      })
      .catch(() => {});

    // From here on, live events for this product; replayed history is already reflected in /wishlist.
    const off = subscribe((e, live) => {
      if (!active || !live || e.refs?.productId !== productId) return;
      setStatus((prev) => {
        const s = nextStatus(e, prev);
        return s === undefined ? prev : s;
      });
    });
    return () => {
      active = false;
      off();
    };
  }, [agentUrl, productId, subscribe]);

  return { status, setStatus };
}
