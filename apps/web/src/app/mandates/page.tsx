"use client";
// Mandates — the scoped spending power the user has granted agents (DESIGN.md F3).
// Cap progress + revoke. Live data from GET /mandates; fixtures only when the agent is offline.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Mandate } from "@alfred/shared";
import { MandateCard } from "@alfred/ui";
import { type ApiError, getMandates, revokeMandate } from "../../lib/api";

export default function Mandates() {
  const [mandates, setMandates] = useState<Mandate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    getMandates().then((r) => setMandates(r.data));
  }, []);

  async function revoke(m: Mandate) {
    setBusyId(m._id);
    try {
      const updated = await revokeMandate(m._id);
      setMandates((ms) => ms?.map((x) => (x._id === m._id ? updated : x)) ?? null);
      toast.success(`Revoked ${m.label}`);
    } catch (e) {
      const err = e as ApiError;
      toast.error(err.status == null ? "Agent offline — not revoked" : err.body || `Revoke failed (${err.status})`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">Mandates</h1>
      <p className="mt-1 text-sm text-text-muted">
        Scoped cards Alfred can spend from — a cap, a scope, an expiry. Revoke any at any time.
      </p>

      {mandates === null ? null : mandates.length ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {mandates.map((m) => (
            <MandateCard key={m._id} mandate={m} busy={busyId === m._id} onRevoke={() => revoke(m)} />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-card border border-border bg-surface p-6 text-sm text-text-muted">
          No mandates yet. Alfred creates one when you let it watch or buy something.
        </div>
      )}
    </div>
  );
}
