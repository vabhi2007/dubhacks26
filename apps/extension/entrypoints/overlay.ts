// Owner: C. Snap overlay, injected into the page by the background on Alt+Shift+S (Google Lens style):
// hover shows the square a click would keep; click keeps it; drag draws your own box instead; Esc / right-click cancels.
// With a video on screen (e.g. a paused YouTube review): it's paused and framed, and selections inside it stay inside it.
// The overlay removes itself before the screenshot, then the background captures and the side panel crops.
import { clickSquare, contains, dragRect, intersect, MIN_DRAG, MIN_VIDEO_SHARE, type Rect, type Selection } from "../lib/selection";

export type OverlayMessage = { type: "alfred:selection"; selection: Selection } | { type: "alfred:cancel" };
/** Sent back to the tab once the screenshot is taken, so the page can be restored. */
export type CapturedMessage = { type: "alfred:captured" };

const DIM = "rgba(11, 11, 12, 0.45)";
const ACCENT = "#E2A829";
// YouTube's player chrome (controls bar, pause icon, end-screen cards) would sit on top of the product in the frame.
const PLAYER_CHROME =
  ".ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,.ytp-bezel,.ytp-spinner," +
  ".ytp-ce-element,.ytp-cards-teaser,.ytp-paid-content-overlay,.ytp-watermark,.iv-branding";
const RESTORE_AFTER_MS = 2_000; // restore the page even if the "captured" message never arrives

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

export default defineUnlistedScript(() => {
  const w = window as Window & { __alfredOverlay?: boolean };
  if (w.__alfredOverlay) return; // already open on this page
  w.__alfredOverlay = true;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const viewport = () => ({ w: innerWidth, h: innerHeight });
  const screen: Rect = { x: 0, y: 0, ...viewport() };

  // The most visible <video>, if it's big enough to be what you're watching (not a thumbnail or a small ad).
  const video = [...document.querySelectorAll("video")]
    .map((el) => ({ el, rect: intersect(rectOf(el), screen) }))
    .filter((v): v is { el: HTMLVideoElement; rect: Rect } => !!v.rect && v.rect.w * v.rect.h >= MIN_VIDEO_SHARE * screen.w * screen.h)
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
  const wasPlaying = !!video && !video.el.paused;
  if (wasPlaying) video.el.pause(); // hold the frame while you choose
  // A selection that starts inside the video stays inside it.
  const boundsAt = (x: number, y: number): Rect => (video && contains(video.rect, x, y) ? video.rect : screen);

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
      .box.frame { border: 1px solid rgba(237, 237, 236, .55); border-radius: 4px; }
      .box.done { ${reduced ? "" : "animation: pop 180ms cubic-bezier(0.22, 1, 0.36, 1);"} }
      @keyframes pop { from { transform: scale(1.04); opacity: .6; } to { transform: none; opacity: 1; } }
      .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: none;
              padding: 8px 14px; border-radius: 999px; border: 1px solid #26262A; background: rgba(20, 20, 22, .88);
              color: #EDEDEC; font: 500 13px/1.3 ui-sans-serif, system-ui, sans-serif; backdrop-filter: blur(8px);
              white-space: nowrap; }
      .hint b { color: ${ACCENT}; font-weight: 600; }
    </style>
    <div class="layer"><div class="box"></div><div class="hint"><b>Alfred</b> · ${
      video ? "Click the item in the video, or drag to select an area" : "Click an item, or drag to select an area"
    } · Esc to cancel</div></div>`;
  const layer = root.querySelector<HTMLDivElement>(".layer")!;
  const box = root.querySelector<HTMLDivElement>(".box")!;

  const show = (r: Rect | undefined, kind: "preview" | "drag" | "frame") => {
    if (!r) {
      box.style.display = "none";
      layer.classList.remove("framed");
      return;
    }
    Object.assign(box.style, { display: "block", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    box.classList.toggle("preview", kind === "preview");
    box.classList.toggle("frame", kind === "frame");
    layer.classList.add("framed"); // the box's shadow does the dimming now, leaving the selection clear
  };
  // At rest: the video stays clear and framed, everything else dims.
  const rest = () => show(video?.rect, "frame");

  let start: { x: number; y: number } | null = null;
  let dragging: Rect | undefined;
  let finished = false;

  const close = () => {
    host.remove();
    removeEventListener("keydown", onKey, true);
    w.__alfredOverlay = false;
  };
  const send = (msg: OverlayMessage) => void browser.runtime.sendMessage(msg).catch(() => {});

  // Hide the player chrome for the screenshot only; put it back once the background says it's captured.
  const hideChrome = () => {
    if (!video) return;
    const style = document.createElement("style");
    style.textContent = `${PLAYER_CHROME} { opacity: 0 !important; transition: none !important; }`;
    document.documentElement.append(style);
    const restore = () => {
      style.remove();
      browser.runtime.onMessage.removeListener(onCaptured);
    };
    const onCaptured = (msg: CapturedMessage) => void (msg?.type === "alfred:captured" && restore());
    browser.runtime.onMessage.addListener(onCaptured);
    setTimeout(restore, RESTORE_AFTER_MS);
  };

  const finish = (rect: Rect, mode: Selection["mode"]) => {
    if (finished) return;
    finished = true;
    show(rect, "drag");
    box.classList.add("done");
    // Let the confirmation show, remove the overlay, and wait two frames so it's not in the screenshot.
    setTimeout(() => {
      close();
      hideChrome();
      requestAnimationFrame(() => requestAnimationFrame(() => send({ type: "alfred:selection", selection: { rect, viewport: viewport(), mode } })));
    }, reduced ? 0 : 180);
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    close();
    if (wasPlaying) void video.el.play().catch(() => {}); // nothing snapped: leave the video as we found it
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
      dragging = dragRect(start.x, start.y, e.clientX, e.clientY, boundsAt(start.x, start.y));
      show(dragging, "drag");
    } else if (!start) {
      show(clickSquare(e.clientX, e.clientY, viewport(), boundsAt(e.clientX, e.clientY)), "preview");
    }
  });
  layer.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !start) return;
    const rect = dragging ?? clickSquare(start.x, start.y, viewport(), boundsAt(start.x, start.y));
    finish(rect, dragging ? "drag" : "click");
  });
  layer.addEventListener("mouseleave", () => !start && rest());
  layer.addEventListener("contextmenu", (e) => (e.preventDefault(), cancel()));
  layer.addEventListener("wheel", (e) => e.preventDefault(), { passive: false }); // the page stays put while selecting
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation(); // before the page (e.g. YouTube) sees it
    cancel();
  };
  addEventListener("keydown", onKey, true);

  // In fullscreen only the fullscreen element is drawn, so the overlay has to live inside it.
  (document.fullscreenElement ?? document.documentElement).append(host);
  rest();
});
