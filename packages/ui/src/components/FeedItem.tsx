// FeedItem — one row in the Agent Feed. Shows which sub-agent acted, on which surface,
// a one-line summary, and relative time. Built against the `events` fixture.
import type { AgentEvent } from "@alfred/shared";
import { cn } from "../cn";
import { relativeTime } from "../time";

const AGENT_LABEL: Record<AgentEvent["agent"], string> = {
  orchestrator: "Alfred",
  vision: "Vision",
  deal: "Deal",
  worth_it: "Worth-It",
  timekeeper: "Timekeeper",
  watcher: "Watcher",
  rewards: "Rewards",
  smart_pay: "Smart Pay",
  messenger: "iMessage",
};

const SURFACE_LABEL: Record<AgentEvent["surface"], string> = {
  web: "Web",
  extension: "Extension",
  imessage: "iMessage",
  voice: "Voice",
  system: "System",
};

// A handful of event types deserve an accent dot (money / decisions).
const ACCENT_TYPES = new Set<AgentEvent["type"]>(["price_drop", "purchase", "approval_requested"]);

export function FeedItem({ event, className }: { event: AgentEvent; className?: string }) {
  return (
    <li className={cn("flex gap-3 py-3", className)}>
      <span
        aria-hidden
        className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", ACCENT_TYPES.has(event.type) ? "bg-accent" : "bg-text-muted/40")}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{event.summary}</p>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
          <span className="font-medium text-text">{AGENT_LABEL[event.agent]}</span>
          <span aria-hidden>·</span>
          <span>{SURFACE_LABEL[event.surface]}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(event.ts).toISOString()}>{relativeTime(event.ts)}</time>
        </div>
      </div>
    </li>
  );
}
