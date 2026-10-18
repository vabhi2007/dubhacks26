// Owner: C. Side panel: receives a snap from background, POSTs /snap, renders product + verdict + offers + Watch.
// Local components use @alfred/ui tokens; swap for D's VerdictCard / OfferRow when they land.
import { useEffect, useState } from "react";
import { APP_NAME, type SnapResponse } from "@alfred/shared";
import { OfferList, ProductHeader, VerdictCard, WatchButton } from "./components";

const AGENT_URL = import.meta.env.WXT_AGENT_URL ?? "http://localhost:8787";

type PendingSnap = { dataUrl: string; pageUrl?: string; at: number };
type Status = { kind: "idle" } | { kind: "snapping"; preview: string } | { kind: "error"; message: string };

export default function App() {
  const [result, setResult] = useState<SnapResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    const handle = async (snap: PendingSnap | undefined) => {
      if (!snap?.dataUrl) return;
      await browser.storage.session.remove("pendingSnap");
      setStatus({ kind: "snapping", preview: snap.dataUrl });
      try {
        const res = await fetch(`${AGENT_URL}/snap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: snap.dataUrl.split(",")[1], source: "extension", pageUrl: snap.pageUrl }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Agent returned ${res.status}`);
        setResult(await res.json());
        setStatus({ kind: "idle" });
      } catch (e) {
        const msg = e instanceof TypeError ? `Couldn't reach the agent at ${AGENT_URL}.` : (e as Error).message;
        setStatus({ kind: "error", message: msg });
      }
    };
    browser.storage.session.get("pendingSnap").then((v) => handle(v.pendingSnap as PendingSnap | undefined));
    const onChange = (changes: Record<string, { newValue?: unknown }>) => handle(changes.pendingSnap?.newValue as PendingSnap | undefined);
    browser.storage.session.onChanged.addListener(onChange);
    return () => browser.storage.session.onChanged.removeListener(onChange);
  }, []);

  return (
    <main className="flex min-h-screen flex-col gap-4 p-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
        <kbd className="rounded-control border border-border px-1.5 py-0.5 text-xs text-text-muted">Alt+Shift+S</kbd>
      </header>

      {status.kind === "snapping" && <Snapping preview={status.preview} />}
      {status.kind === "error" && (
        <p role="alert" className="rounded-card border border-skip/40 bg-skip/10 p-3 text-sm text-skip">{status.message}</p>
      )}
      {status.kind === "idle" && !result && (
        <p className="text-sm text-text-muted">Press Alt+Shift+S to snap what's on screen. {APP_NAME} finds the exact product, the best price, and tells you honestly whether it's worth it.</p>
      )}

      {result && status.kind !== "snapping" && (
        <div className="fade-in flex flex-col gap-4" key={result.verdict._id}>
          <ProductHeader product={result.product} />
          <VerdictCard verdict={result.verdict} />
          <WatchButton agentUrl={AGENT_URL} product={result.product} verdict={result.verdict} />
          <OfferList offers={result.offers} bestOfferId={result.verdict.math.bestOfferId} />
        </div>
      )}
    </main>
  );
}

function Snapping({ preview }: { preview: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <img src={preview} alt="Your snap" className="max-h-40 w-full rounded-card border border-border object-cover opacity-70" />
      <p className="text-sm text-text-muted">Looking it up…</p>
      <div className="h-28 animate-pulse rounded-card bg-surface-2 motion-reduce:animate-none" />
      <div className="h-16 animate-pulse rounded-card bg-surface-2 motion-reduce:animate-none" />
    </div>
  );
}
