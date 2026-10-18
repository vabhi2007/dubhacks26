"use client";
// The web chat thread and its turn runner (POST /chat, DESIGN.md §8.3). The thread lives in localStorage: the agent
// keeps its own copy (shared with iMessage) but has no route to read it back yet. A module-level store like useEvents,
// so a reply keeps streaming in if you navigate away mid-turn, and the server snapshot is null so the first client
// render reads storage without a hydration mismatch.
import { useSyncExternalStore } from "react";
import type { AgentEvent } from "@alfred/shared";
import { type ApiError, streamChat } from "./api";

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  verdictId?: string;
  steps?: string[]; // summaries of sub-agent events emitted during this turn
  error?: string;
  state?: "streaming" | "stopped";
};

const STORAGE_KEY = "alfred.chat.v1";
const KEEP = 100; // messages kept
const STEP_GRACE_MS = 2_000; // browser ↔ agent clock skew when matching a turn's events

let thread: ChatMsg[] | null = null;
let turn: { id: string; startedAt: number; abort: AbortController } | null = null;
const listeners = new Set<() => void>();

function load(): ChatMsg[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    // A reload mid-reply leaves a half-streamed message; it can't resume.
    return (saved as ChatMsg[]).map((m) => (m.state === "streaming" ? { ...m, state: "stopped" } : m));
  } catch {
    return [];
  }
}

const snapshot = () => (thread ??= load());

function setThread(fn: (msgs: ChatMsg[]) => ChatMsg[]) {
  thread = fn(snapshot()).slice(-KEEP);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(thread));
  } catch {
    // storage full or disabled — the thread still works for this visit
  }
  listeners.forEach((l) => l());
}

const patch = (id: string, fn: (m: ChatMsg) => ChatMsg) => setThread((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The thread, oldest first. null on the server and during hydration. */
export function useChatThread(): ChatMsg[] | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

function errorText(body: string | undefined, status: number) {
  try {
    const e: unknown = JSON.parse(body ?? "").error;
    if (typeof e === "string") return e;
  } catch {
    // not JSON
  }
  return `Alfred couldn't answer (error ${status}).`;
}

async function run(id: string, text: string, abort: AbortController) {
  try {
    for await (const { delta, error, done, verdictId } of streamChat(text, abort.signal)) {
      if (delta) patch(id, (m) => ({ ...m, text: m.text + delta }));
      if (error) patch(id, (m) => ({ ...m, error }));
      if (done && verdictId) patch(id, (m) => ({ ...m, verdictId }));
    }
    patch(id, (m) => ({ ...m, state: undefined }));
  } catch (err) {
    if (abort.signal.aborted) {
      patch(id, (m) => ({ ...m, state: "stopped" }));
    } else {
      const { status, body } = err as ApiError;
      const error = status == null ? "Agent offline — couldn't reach Alfred." : errorText(body, status);
      patch(id, (m) => ({ ...m, state: undefined, error }));
    }
  } finally {
    if (turn?.id === id) turn = null;
  }
}

/** Start a turn. false when the text is empty or a reply is still streaming. */
export function sendChat(text: string): boolean {
  const q = text.trim();
  if (!q || turn) return false;
  const id = crypto.randomUUID();
  turn = { id, startedAt: Date.now(), abort: new AbortController() };
  setThread((ms) => [
    ...ms,
    { id: crypto.randomUUID(), role: "user", text: q },
    { id, role: "assistant", text: "", state: "streaming" },
  ]);
  void run(id, q, turn.abort);
  return true;
}

/** Stop reading the reply. The agent still finishes (and remembers) the turn. */
export const stopChat = () => turn?.abort.abort();

/** Clear this view. Alfred still remembers recent turns server-side. */
export function clearChat() {
  stopChat();
  turn = null;
  setThread(() => []);
}

/** A feed event during the running turn becomes a progress step on its reply ("message" is the reply itself). */
export function addTurnStep(e: AgentEvent) {
  if (!turn || e.surface !== "web" || e.type === "message") return;
  if (new Date(e.ts).getTime() < turn.startedAt - STEP_GRACE_MS) return;
  const id = turn.id;
  patch(id, (m) => ({ ...m, steps: [...(m.steps ?? []), e.summary] }));
}
