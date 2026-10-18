// Owner: C. Snap overlay, injected into the page by the background on Alt+Shift+S (Google Lens style):
// hover shows the square a click would keep; click keeps it; drag draws your own box instead; Esc / right-click cancels.
// The overlay removes itself before the screenshot, then the background captures and the side panel crops.
import { clickSquare, dragRect, MIN_DRAG, type Rect, type Selection } from "../lib/selection";

export type OverlayMessage = { type: "alfred:selection"; selection: Selection } | { type: "alfred:cancel" };

const DIM = "rgba(11, 11, 12, 0.45)";
const ACCENT = "#E2A829";

export default defineUnlistedScript(() => {
  const w = window as Window & { __alfredOverlay?: boolean };
  if (w.__alfredOverlay) return; // already open on this page
  w.__alfredOverlay = true;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const viewport = () => ({ w: innerWidth, h: innerHeight });
  const bounds = (): Rect => ({ x: 0, y: 0, ...viewport() });

  // Shadow DOM so the page's CSS can't restyle the overlay (and ours can't leak into the page).
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .layer { position: fixed; inset: 0; cursor: crosshair; background: ${DIM}; }
      .layer.framed { background: transparent; }
      .box { position: fixed; display: none; pointer-events: none; border: 2px solid ${ACCENT}; border-radius: 10px;
             box-shadow: 0 0 0 200vmax ${DIM}; box-sizing: border-box; }
      .box.preview { border-style: dashed; }
      .box.done { ${reduced ? "" : "animation: pop 180ms cubic-bezier(0.22, 1, 0.36, 1);"} }
      @keyframes pop { from { transform: scale(1.04); opacity: .6; } to { transform: none; opacity: 1; } }
      .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: none;
              padding: 8px 14px; border-radius: 999px; border: 1px solid #26262A; background: rgba(20, 20, 22, .88);
              color: #EDEDEC; font: 500 13px/1.3 ui-sans-serif, system-ui, sans-serif; backdrop-filter: blur(8px);
              white-space: nowrap; }
      .hint b { color: ${ACCENT}; font-weight: 600; }
    </style>
    <div class="layer"><div class="box"></div><div class="hint"><b>Alfred</b> · Click an item, or drag to select an area · Esc to cancel</div></div>`;
  const layer = root.querySelector<HTMLDivElement>(".layer")!;
  const box = root.querySelector<HTMLDivElement>(".box")!;

  const show = (r: Rect | undefined, kind: "preview" | "drag") => {
    if (!r) {
      box.style.display = "none";
      layer.classList.remove("framed");
      return;
    }
    Object.assign(box.style, { display: "block", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    box.classList.toggle("preview", kind === "preview");
    layer.classList.add("framed"); // the box's shadow does the dimming now, leaving the selection clear
  };

  let start: { x: number; y: number } | null = null;
  let dragging: Rect | undefined;
  let finished = false;

  const close = () => {
    host.remove();
    removeEventListener("keydown", onKey, true);
    w.__alfredOverlay = false;
  };
  const send = (msg: OverlayMessage) => void browser.runtime.sendMessage(msg).catch(() => {});

  const finish = (rect: Rect, mode: Selection["mode"]) => {
    if (finished) return;
    finished = true;
    show(rect, "drag");
    box.classList.add("done");
    // Let the confirmation show, remove the overlay, and wait two frames so it's not in the screenshot.
    setTimeout(() => {
      close();
      requestAnimationFrame(() => requestAnimationFrame(() => send({ type: "alfred:selection", selection: { rect, viewport: viewport(), mode } })));
    }, reduced ? 0 : 180);
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    close();
    send({ type: "alfred:cancel" });
  };

  layer.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY };
    dragging = undefined;
  });
  layer.addEventListener("mousemove", (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= MIN_DRAG) {
      dragging = dragRect(start.x, start.y, e.clientX, e.clientY, bounds());
      show(dragging, "drag");
    } else if (!start) {
      show(clickSquare(e.clientX, e.clientY, viewport(), bounds()), "preview");
    }
  });
  layer.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !start) return;
    const rect = dragging ?? clickSquare(start.x, start.y, viewport(), bounds());
    finish(rect, dragging ? "drag" : "click");
  });
  layer.addEventListener("mouseleave", () => !start && show(undefined, "preview"));
  layer.addEventListener("contextmenu", (e) => (e.preventDefault(), cancel()));
  layer.addEventListener("wheel", (e) => e.preventDefault(), { passive: false }); // the page stays put while selecting
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  addEventListener("keydown", onKey, true);

  document.documentElement.append(host);
});
