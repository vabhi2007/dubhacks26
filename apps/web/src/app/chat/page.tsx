"use client";
// Chat — ask Alfred anything (DESIGN.md F7, §8.3 POST /chat). Replies stream in as {delta}… then {done, verdictId?};
// a verdictId renders that Verdict Card inline under the reply. While a turn runs, the sub-agents' own feed events
// (snap, verdict, watch…) show as progress steps. Thread + streaming live in lib/chat.ts.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import { ArrowUp, Check, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import type { AgentEvent, Verdict } from "@alfred/shared";
import { fmtUSD, watchTarget } from "@alfred/shared";
import { VerdictCard, enterUp, fade } from "@alfred/ui";
import { type ApiError, type VerdictView, type WatchView, createWatch, getVerdict, getWishlist } from "../../lib/api";
import { type ChatMsg, addTurnStep, clearChat, sendChat, stopChat, useChatThread } from "../../lib/chat";
import { useAgentEvent } from "../../lib/useEvents";
import { VerdictGraphs } from "../../components/VerdictGraphs";

const STICK_PX = 80; // within this of the bottom, new text keeps the thread scrolled down

// Anything that changes a product's watch state (reset emits "message").
const WATCH_EVENTS = new Set<AgentEvent["type"]>(["watch_created", "purchase", "message"]);

const SUGGESTIONS = [
  "Is the Breville Bambino Plus worth it?",
  "Should I upgrade my iPhone now or wait?",
  "Which rewards programs should I join?",
  "Watch the Bambino Plus and tell me if it drops",
];

function VerdictSkeleton() {
  return (
    <div aria-hidden className="rounded-card border border-border bg-surface p-6">
      <div className="h-3 w-1/3 bg-surface-2" />
      <div className="mt-3 h-5 w-3/4 bg-surface-2" />
      <div className="mt-5 h-3 w-1/2 bg-surface-2" />
    </div>
  );
}

function StatePill({ children, tone }: { children: React.ReactNode; tone: "accent" | "buy" }) {
  const cls = tone === "buy" ? "text-buy bg-buy/10" : "text-accent bg-accent-subtle";
  return <span className={`inline-flex items-center rounded-control px-4 py-2 text-sm font-medium ${cls}`}>{children}</span>;
}

export default function Chat() {
  const msgs = useChatThread();
  // Messages already there on mount don't play the entrance animation (DESIGN.md §6: once, on state change).
  const [restored, setRestored] = useState<Set<string> | null>(null);
  if (msgs && !restored) setRestored(new Set(msgs.map((m) => m.id)));
  const [draft, setDraft] = useState("");
  const [verdicts, setVerdicts] = useState<Record<string, VerdictView | null>>({});
  const [wishlist, setWishlist] = useState<WatchView[]>([]);
  const requested = useRef(new Set<string>()); // verdict ids already fetched
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const busy = msgs?.some((m) => m.state === "streaming") ?? false;
  const reloadWishlist = () => getWishlist().then((r) => setWishlist(r.data));

  useEffect(() => {
    reloadWishlist();
  }, []);

  useEffect(() => {
    for (const { verdictId: id } of msgs ?? []) {
      if (!id || requested.current.has(id)) continue;
      requested.current.add(id);
      getVerdict(id).then((v) => setVerdicts((s) => ({ ...s, [id]: v })));
    }
  }, [msgs]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, verdicts]);

  useAgentEvent((e) => {
    if (WATCH_EVENTS.has(e.type)) reloadWishlist();
    addTurnStep(e);
  });

  function send(text: string) {
    if (!sendChat(text)) return;
    stick.current = true;
    setDraft("");
  }

  async function watch(v: Verdict) {
    const target = watchTarget(v.math.priceCents, v.math.expectedDropCents);
    if (target === undefined) {
      toast.error("No sensible watch target for this price");
      return;
    }
    try {
      await createWatch(v.productId, target);
      toast.success(`Watching — buys at ${fmtUSD(target)}`);
      reloadWishlist();
    } catch (err) {
      const { status: code, body } = err as ApiError;
      toast.error(code == null ? "Agent offline — not watching" : body || `Couldn't watch (${code})`);
    }
  }

  // Same CTA states as Home: Watching > Bought > Watch for a drop.
  const watchOf = (v: VerdictView) =>
    wishlist.find((w) => w.productId === v.productId && (w.status === "watching" || w.status === "triggered"));

  function verdictCta(v: VerdictView) {
    const mine = wishlist.filter((w) => w.productId === v.productId);
    if (watchOf(v)) return null; // the card shows an eye + target price instead
    if (v.kind === "skip") return null; // Skip: a small drop won't make it worth it — no watch offer (same as the extension)
    if (mine.some((w) => w.status === "bought")) return <StatePill tone="buy">Bought</StatePill>;
    return (
      <button
        type="button"
        onClick={() => watch(v)}
        className="rounded-control border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:border-accent/50"
      >
        Watch for a drop
      </button>
    );
  }

  function renderMessage(m: ChatMsg) {
    const enter = { initial: restored?.has(m.id) ? false : enterUp.initial, animate: enterUp.animate, transition: enterUp.transition };
    if (m.role === "user") {
      return (
        <motion.div key={m.id} {...enter} className="flex justify-end">
          <div className="max-w-[80%] whitespace-pre-wrap border border-border bg-surface-2 px-4 py-2.5 text-[15px] leading-relaxed">
            {m.text}
          </div>
        </motion.div>
      );
    }
    const v = m.verdictId ? verdicts[m.verdictId] : undefined;
    const silent = !m.text && !m.error && !m.verdictId && !m.state; // tools ran but nothing was said
    return (
      <motion.div key={m.id} {...enter} className="flex gap-3">
        <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        <div className="min-w-0 flex-1 space-y-3">
          {m.steps?.length ? (
            <ul className="space-y-1">
              {m.steps.map((s, i) => (
                <li key={`${i}-${s}`} className="flex items-center gap-2 text-xs text-text-muted">
                  <Check size={12} strokeWidth={2} className="shrink-0 text-buy" />
                  <span className="truncate">{s}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {m.text ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.text}</p>
          ) : m.state === "streaming" && !m.steps?.length ? (
            <p className="text-[15px] text-text-muted">Thinking…</p>
          ) : silent ? (
            <p className="text-[15px] text-text-muted">Done.</p>
          ) : null}
          {m.error ? <p className="text-sm text-skip">{m.error}</p> : null}
          {m.state === "stopped" ? <p className="text-xs text-text-muted">Stopped</p> : null}
          {m.verdictId ? (
            v === undefined ? (
              <VerdictSkeleton />
            ) : v ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
                <VerdictCard
                  verdict={v}
                  product={{ title: v.product?.title ?? "", imageUrl: v.product?.imageUrl }}
                  actions={verdictCta(v)}
                  watchingCents={watchOf(v)?.targetPriceCents}
                  details={<VerdictGraphs verdict={v} />}
                />
              </motion.div>
            ) : null
          ) : null}
        </div>
      </motion.div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="font-serif text-[28px] tracking-tight">Chat</h1>
                <p className="mt-1 text-sm text-text-muted">Ask if something&rsquo;s worth it, watch a price, or buy within your rules.</p>
              </div>
              {msgs?.length ? (
                <button
                  type="button"
                  onClick={clearChat}
                  title="Clears this view. Alfred still remembers recent turns."
                  className="mt-1 flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <RotateCcw size={14} strokeWidth={1.75} />
                  Clear
                </button>
              ) : null}
            </div>

            {msgs === null ? null : msgs.length ? (
              <div className="mt-8 space-y-6">{msgs.map(renderMessage)}</div>
            ) : (
              <div className="mt-10">
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Try</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-control border border-border bg-surface px-4 py-3 text-left text-sm transition-colors hover:bg-surface-2"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-bg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="mx-auto flex w-full max-w-3xl items-end gap-2 px-6 py-4"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              autoFocus
              aria-label="Message Alfred"
              placeholder="Ask Alfred…"
              className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none rounded-control border border-border bg-surface px-4 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-text-muted focus:border-accent/60"
            />
            {busy ? (
              <button
                type="button"
                onClick={stopChat}
                aria-label="Stop"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-border bg-surface-2 transition-colors hover:border-text-muted"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label="Send"
                className="btn-gold grid h-11 w-11 shrink-0 place-items-center rounded-control transition-[filter] disabled:opacity-40"
              >
                <ArrowUp size={18} strokeWidth={2} />
              </button>
            )}
          </form>
        </div>
      </div>
    </MotionConfig>
  );
}
