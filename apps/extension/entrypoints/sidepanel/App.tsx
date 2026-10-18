// Owner: C. Side panel: receives a snap from background, POSTs /snap, renders product + verdict + offers + Watch.
// Local components use @alfred/ui tokens; swap for D's VerdictCard / OfferRow when they land.
import { useEffect, useRef, useState } from "react";
import { APP_NAME, SnapResponse, watchTarget } from "@alfred/shared";
import { OfferStrip, PriceHistory, ProductHeader, SimilarList, VerdictCard, WatchButton } from "./components";
import { useWatchStatus } from "./watchStatus";
import { toImageRect, type Selection } from "../../lib/selection";
import type { PendingSnap } from "../background";

const AGENT_URL = import.meta.env.WXT_AGENT_URL ?? "http://localhost:8787";


// Vision models gain nothing past ~1568px on the long edge; smaller uploads are faster and stay under API image limits.
const MAX_EDGE = 1568;
// Agent: vision ≤ 12s budget + Worth-It ≈ 8–10s. Past this, say so instead of showing the skeleton forever.
const SNAP_TIMEOUT_MS = 45_000;

/**
 * Crop a captured frame to the overlay's selection (if any), downscale, and encode as JPEG.
 * Returns the base64 to upload (no data: prefix) and an object URL of the same image for the "looking it up" preview.
 */
async function prepareUpload(dataUrl: string, selection?: Selection): Promise<{ image: string; preview: string }> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const src = selection ? toImageRect(selection.rect, selection.viewport, bitmap) : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  const scale = Math.min(1, MAX_EDGE / Math.max(src.w, src.h));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(src.w * scale)), Math.max(1, Math.round(src.h * scale)));
  canvas.getContext("2d")!.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { image: btoa(bin), preview: URL.createObjectURL(blob) };
}
type Status = { kind: "idle" } | { kind: "snapping"; preview: string } | { kind: "error"; message: string };

export default function App() {
  const [result, setResult] = useState<SnapResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Only the newest snap may update the panel; older in-flight requests are aborted and their responses ignored.
  const latest = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const lastSnapAt = useRef<number | null>(null);
  const lastPreview = useRef<string | null>(null); // object URL of the current preview, released when replaced

  useEffect(() => {
    let active = true;
    const handle = async (snap: PendingSnap | undefined) => {
      // StrictMode and the get()/onChanged overlap can deliver the same snap twice; `at` identifies it.
      if (!active || !snap?.dataUrl || snap.at === lastSnapAt.current) return;
      lastSnapAt.current = snap.at;
      const id = ++latest.current;
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;
      await browser.storage.session.remove("pendingSnap");
      setResult(null);
      let image: string;
      try {
        const prepared = await prepareUpload(snap.dataUrl, snap.selection);
        image = prepared.image;
        if (id !== latest.current) return URL.revokeObjectURL(prepared.preview);
        if (lastPreview.current) URL.revokeObjectURL(lastPreview.current);
        lastPreview.current = prepared.preview;
        setStatus({ kind: "snapping", preview: prepared.preview }); // shows exactly what was selected
      } catch {
        if (id === latest.current) setStatus({ kind: "error", message: "Couldn't process the screenshot. Try snapping again." });
        return;
      }
      const timeout = AbortSignal.timeout(SNAP_TIMEOUT_MS);
      try {
        const res = await fetch(`${AGENT_URL}/snap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image, source: "extension", pageUrl: snap.pageUrl }),
          signal: AbortSignal.any([ac.signal, timeout]),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `Agent returned ${res.status}`);
        const parsed = SnapResponse.safeParse(body);
        if (!parsed.success) throw new Error("The agent sent back something unexpected.");
        if (id !== latest.current) return;
        setResult(parsed.data);
        setStatus({ kind: "idle" });
      } catch (e) {
        if (id !== latest.current || ac.signal.aborted) return;
        const msg = timeout.aborted
          ? "The agent took too long to answer. Try snapping again."
          : e instanceof TypeError ? `Couldn't reach the agent at ${AGENT_URL}.` : (e as Error).message;
        setStatus({ kind: "error", message: msg });
      }
    };
    browser.storage.session.get("pendingSnap").then((v) => handle(v.pendingSnap as PendingSnap | undefined));
    const onChange = (changes: Record<string, { newValue?: unknown }>) => handle(changes.pendingSnap?.newValue as PendingSnap | undefined);
    browser.storage.session.onChanged.addListener(onChange);
    return () => {
      active = false;
      browser.storage.session.onChanged.removeListener(onChange);
    };
  }, []);

  const watch = useWatchStatus(AGENT_URL, result?.product._id);
  // A watch that already exists (or fired) stays visible even when this verdict says skip.
  const canWatch = result && ((result.offers.length > 0 && result.verdict.kind !== "skip") || !!watch.status);

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="font-serif text-[22px] leading-none">{APP_NAME}</h1>
        <kbd className="border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-muted">Alt+Shift+S</kbd>
      </header>

      {status.kind === "snapping" && <Snapping preview={status.preview} />}
      {status.kind === "error" && (
        <p role="alert" className="border border-skip/40 bg-skip/10 p-3 text-sm text-skip">{status.message}</p>
      )}
      {status.kind === "idle" && !result && (
        <p className="text-sm text-text-muted">Press Alt+Shift+S to snap what's on screen. {APP_NAME} finds the exact product, the best price, and tells you honestly whether it's worth it.</p>
      )}

      {result && status.kind === "idle" && (
        <div className="fade-in flex flex-col gap-3.5" key={result.verdict._id}>
          <ProductHeader product={result.product} />
          <VerdictCard verdict={result.verdict} />
          {canWatch && <WatchButton agentUrl={AGENT_URL} product={result.product} verdict={result.verdict} status={watch.status} onStatus={watch.setStatus} />}
          {inCatalog(result.product._id) && (
            <PriceHistory
              agentUrl={AGENT_URL}
              productId={result.product._id}
              targetCents={watch.status ? undefined : watchTarget(result.verdict.math.priceCents, result.verdict.math.expectedDropCents)}
            />
          )}
          <OfferStrip offers={result.offers} bestOfferId={result.verdict.math.bestOfferId} />
          <SimilarList products={result.similar} />
        </div>
      )}
    </main>
  );
}

// Unidentified snaps and products Claude named that aren't saved yet have no price history to fetch.
const inCatalog = (id: string) => id !== "prd_unidentified" && !id.startsWith("prd_new_");

function Snapping({ preview }: { preview: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <img src={preview} alt="Your snap" className="max-h-40 w-full border border-border object-cover opacity-70" />
      <p className="text-sm text-text-muted">Looking it up…</p>
      <div className="h-28 animate-pulse bg-surface-2 motion-reduce:animate-none" />
      <div className="h-16 animate-pulse bg-surface-2 motion-reduce:animate-none" />
    </div>
  );
}
