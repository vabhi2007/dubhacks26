"use client";
// /admin — demo control (DESIGN.md §3). Big, obvious buttons for the live demo.
// NOTE: price-drop / reset write to the SHARED Atlas db — only Workstream A fires these
// during the demo (CONTRIBUTING "Shared database"). This is the UI; D does not run them.
import { useState } from "react";
import { toast } from "sonner";
import { adminPriceDrop, adminReset, type ApiError } from "../../lib/api";

type Drop = { productId: string; label: string; newPriceCents: number };

const HERO_DROPS: Drop[] = [
  { productId: "prd_bambino", label: "Bambino → $149", newPriceCents: 149_00 },
  { productId: "prd_bambino", label: "Bambino → $129", newPriceCents: 129_00 },
  { productId: "prd_iphone17", label: "iPhone → $699", newPriceCents: 699_00 },
];

// A refusal from a running agent (403/503/404) carries a message — show it instead of "offline".
const errorMessage = (e: ApiError, offline: string) =>
  e.status == null ? offline : e.body || `Failed (${e.status})`;

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

  const anyBusy = busy !== null;

  async function drop(d: Drop) {
    if (anyBusy) return;
    setBusy(d.label);
    try {
      await adminPriceDrop({ productId: d.productId, newPriceCents: d.newPriceCents });
      toast.success(`Price dropped: ${d.label}`);
    } catch (e) {
      toast.error(errorMessage(e as ApiError, "Agent offline — price drop not sent"));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (anyBusy) return;
    if (!confirm("Reset the demo persona? This writes to the shared Atlas db.")) return;
    setBusy("reset");
    try {
      await adminReset();
      toast.success("Persona reset");
    } catch (e) {
      toast.error(errorMessage(e as ApiError, "Agent offline — reset not sent"));
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
            <BigButton key={d.label} onClick={() => drop(d)} busy={anyBusy} variant="accent">
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
        <BigButton onClick={reset} busy={anyBusy} variant="danger">
          Reset persona
        </BigButton>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Agent flags</h2>
        <p className="text-sm text-text-muted">
          <code>PRICE_SOURCE</code>, <code>VISION_SOURCE</code> and <code>MESSENGER</code> are set in the agent&rsquo;s
          root <code>.env</code>. The dashboard can&rsquo;t read them — run <code>pnpm check:env</code> to see the
          active values.
        </p>
      </section>
    </div>
  );
}
