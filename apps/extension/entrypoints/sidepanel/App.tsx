// Owner: C. Side panel: receives a snap from background, POSTs /snap, renders the verdict (shared @alfred/ui components).
import { useEffect, useState } from "react";
import { APP_NAME, fmtUSD, type SnapResponse } from "@alfred/shared";
import { VerdictBadge } from "@alfred/ui";

const AGENT_URL = import.meta.env.WXT_AGENT_URL ?? "http://localhost:8787";

export default function App() {
  const [result, setResult] = useState<SnapResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "snapping" | "error">("idle");

  useEffect(() => {
    const handle = async (snap: { dataUrl: string; pageUrl?: string } | undefined) => {
      if (!snap) return;
      setStatus("snapping");
      try {
        const res = await fetch(`${AGENT_URL}/snap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: snap.dataUrl.split(",")[1], source: "extension", pageUrl: snap.pageUrl }),
        });
        setResult(await res.json());
        setStatus("idle");
      } catch {
        setStatus("error");
      }
      await browser.storage.session.remove("pendingSnap");
    };
    browser.storage.session.get("pendingSnap").then((v) => handle(v.pendingSnap as never));
    const onChange = (changes: Record<string, { newValue?: unknown }>) => handle(changes.pendingSnap?.newValue as never);
    browser.storage.session.onChanged.addListener(onChange);
    return () => browser.storage.session.onChanged.removeListener(onChange);
  }, []);

  return (
    <main className="p-5">
      <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
      {!result && (
        <p className="mt-2 text-sm text-text-muted">
          {status === "snapping" ? "Looking it up…" : status === "error" ? "Couldn't reach the agent on :8787." : "Press Alt+Shift+S to snap what's on screen."}
        </p>
      )}
      {result && (
        <section className="mt-4 rounded-card border border-border bg-surface p-4">
          <div className="text-sm text-text-muted">{result.product.title}</div>
          <div className="mt-2"><VerdictBadge kind={result.verdict.kind} /></div>
          <p className="mt-2">{result.verdict.headline}</p>
          <div className="num mt-3 text-accent">{fmtUSD(result.verdict.math.priceCents)}</div>
        </section>
      )}
    </main>
  );
}
