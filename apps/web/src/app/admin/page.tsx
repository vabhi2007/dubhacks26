"use client";
// /admin — demo control (DESIGN.md §3). Big, obvious buttons for the live demo.
// NOTE: price-drop / reset write to the SHARED Atlas db — only Workstream A fires these
// during the demo (CONTRIBUTING "Shared database"). This is the UI; D does not run them.
import { useState } from "react";
import { toast } from "sonner";
import { adminPriceDrop, adminReset } from "../../lib/api";

type Drop = { productId: string; label: string; newPriceCents: number };

const HERO_DROPS: Drop[] = [
  { productId: "prd_bambino", label: "Bambino → $149", newPriceCents: 149_00 },
  { productId: "prd_bambino", label: "Bambino → $129", newPriceCents: 129_00 },
  { productId: "prd_iphone17", label: "iPhone → $699", newPriceCents: 699_00 },
];

const FLAGS = [
  { name: "PRICE_SOURCE", value: "mock" },
  { name: "VISION_SOURCE", value: "claude" },
  { name: "MESSENGER", value: "console" },
];

function BigButton({
  children,
  onClick,
  busy,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  variant?: "default" | "accent" | "danger";
}) {
  const styles = {
    default: "border border-border bg-surface hover:bg-surface-2",
    accent: "bg-accent text-on-accent hover:bg-accent-hover",
    danger: "border border-skip/40 text-skip hover:bg-skip/10",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-control px-5 py-4 text-sm font-medium transition-colors disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export default function Admin() {
  const [busy, setBusy] = useState<string | null>(null);

  async function drop(d: Drop) {
    setBusy(d.label);
    try {
      await adminPriceDrop({ productId: d.productId, newPriceCents: d.newPriceCents });
      toast.success(`Price dropped: ${d.label}`);
    } catch {
      toast.error("Agent offline — price drop not sent");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!confirm("Reset the demo persona? This writes to the shared Atlas db.")) return;
    setBusy("reset");
    try {
      await adminReset();
      toast.success("Persona reset");
    } catch {
      toast.error("Agent offline — reset not sent");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">Demo control</h1>
      <p className="mt-1 text-sm text-text-muted">Trigger the scripted moments. Hidden from the main nav.</p>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Price drop</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {HERO_DROPS.map((d) => (
            <BigButton key={d.label} onClick={() => drop(d)} busy={busy === d.label} variant="accent">
              {d.label}
            </BigButton>
          ))}
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Drops the hero product price → Watcher creates an approval → approve on Home.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Persona</h2>
        <BigButton onClick={reset} busy={busy === "reset"} variant="danger">
          Reset persona
        </BigButton>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Current flags</h2>
        <div className="flex flex-wrap gap-2">
          {FLAGS.map((f) => (
            <span
              key={f.name}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs"
            >
              <span className="text-text-muted">{f.name}</span>
              <span className="num text-accent">{f.value}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-text-muted">Set in the root <code>.env</code>; restart the agent to change.</p>
      </section>
    </div>
  );
}
