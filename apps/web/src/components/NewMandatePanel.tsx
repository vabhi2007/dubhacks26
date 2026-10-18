"use client";
// Issue a new mandate (DESIGN.md F3): label, cap, duration, which agent may spend it, and what it may buy —
// with a live card preview. POST /mandates picks the card number; spending still goes only through authorize().
import { useState } from "react";
import { toast } from "sonner";
import { Category as Categories, type Category, type Mandate, MANDATE_CAP_LIMIT_CENTS, fmtUSD } from "@alfred/shared";
import { cn, MandateCard } from "@alfred/ui";
import { agentErrorMessage, type ApiError, createMandate, type NewMandate } from "../lib/api";

const AGENTS: { value: NewMandate["agent"]; label: string; hint: string }[] = [
  { value: "watcher", label: "Watcher", hint: "Buys watched items when the price drops" },
  { value: "orchestrator", label: "Alfred chat", hint: "Buys when you ask in chat or iMessage" },
  { value: "smart_pay", label: "Smart Pay", hint: "Everyday purchases on the best card" },
];
const DURATIONS = [7, 30, 90];
const CATEGORIES = Categories.options as readonly Category[];
const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

const field = "border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent";
const chip = (on: boolean) =>
  cn("border px-2.5 py-1 text-xs transition-colors", on ? "border-accent/60 bg-accent-subtle text-accent" : "border-border text-text-muted hover:text-text");

export function NewMandatePanel({ onCreated, onCancel }: { onCreated: (m: Mandate) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [cap, setCap] = useState("150");
  const [days, setDays] = useState(30);
  const [agent, setAgent] = useState<NewMandate["agent"]>("watcher");
  const [cats, setCats] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);

  const capCents = Math.round(Number(cap) * 100);
  const capOk = Number.isFinite(capCents) && capCents > 0 && capCents <= MANDATE_CAP_LIMIT_CENTS;
  const ready = name.trim().length > 0 && capOk && cats.length > 0;

  const previewMandate: Mandate = {
    _id: "mnd_preview", userId: "", agent, label: name.trim() || "New mandate", capCents: capOk ? capCents : 0, spentCents: 0,
    categories: cats, merchants: [], expiresAt: new Date(Date.now() + days * 86_400_000), status: "active", card: { last4: "••••", token: "" },
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      const m = await createMandate({ label: name.trim(), agent, capCents, categories: cats, days });
      toast.success(`“${m.label}” is live on Visa ••${m.card.last4}`);
      onCreated(m);
    } catch (err) {
      toast.error(agentErrorMessage(err as ApiError, "Agent offline — mandate not created"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="enter-up mt-6 grid gap-6 border border-border bg-surface p-5 lg:grid-cols-[1fr_320px]" aria-label="New mandate">
      <div className="space-y-5">
        <div>
          <h2 className="font-serif text-xl tracking-tight">New mandate</h2>
          <p className="mt-1 text-sm text-text-muted">A scoped virtual Visa: a cap, what it may buy, and an end date. Over your ask-first limit, Alfred still asks.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <label className="flex flex-col gap-1.5 text-xs text-text-muted">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Desk setup" className={field} autoFocus />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-text-muted">
            Spending cap
            <span className={cn(field, "flex items-center gap-1", !capOk && cap !== "" && "border-skip")}>
              <span className="text-text-muted">$</span>
              <input value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-label="Spending cap in dollars" className="num w-full bg-transparent outline-none" />
            </span>
          </label>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs text-text-muted">Duration</legend>
          <div className="flex gap-1.5">
            {DURATIONS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={chip(days === d)}>
                {d} days
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs text-text-muted">Who can spend it</legend>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {AGENTS.map((a) => (
              <button key={a.value} type="button" onClick={() => setAgent(a.value)} aria-pressed={agent === a.value} className={cn(chip(agent === a.value), "px-3 py-2 text-left")}>
                <span className="block text-sm">{a.label}</span>
                <span className="block text-[11px] text-text-muted">{a.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs text-text-muted">What it can buy {cats.length ? `· ${cats.length} selected` : "· pick at least one"}</legend>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" onClick={() => setCats((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))} aria-pressed={cats.includes(c)} className={chip(cats.includes(c))}>
                {label(c)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={!ready || busy} className="btn-gold px-4 py-2 text-sm font-medium disabled:opacity-40">
            {busy ? "Issuing…" : `Issue ${capOk ? fmtUSD(capCents, { compact: true }) : ""} card`}
          </button>
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-text-muted hover:text-text">
            Cancel
          </button>
          {!capOk && cap !== "" ? <span className="text-xs text-skip">Cap must be between $1 and {fmtUSD(MANDATE_CAP_LIMIT_CENTS, { compact: true })}</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-text-muted">Preview</span>
        <MandateCard mandate={previewMandate} preview />
        <p className="text-xs text-text-muted">{cats.length ? `Covers ${cats.map(label).join(", ")}.` : "No categories yet."} The card number is issued when you create it.</p>
      </div>
    </form>
  );
}
