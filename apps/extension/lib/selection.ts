// Owner: C. Snap selection geometry, shared by the page overlay and the side panel. All rects are in CSS pixels of
// the viewport (what the overlay sees) until toImageRect maps them onto the captured screenshot.

export type Rect = { x: number; y: number; w: number; h: number };
export type Viewport = { w: number; h: number };

/** What the overlay sends back: the area to keep, plus the viewport it was measured in. */
export type Selection = { rect: Rect; viewport: Viewport; mode: "click" | "drag" };

const SQUARE_SHARE = 0.35; // a click keeps a square about a third of the screen's short side…
const SQUARE_MIN = 220; // …but never smaller than this (CSS px)
const SQUARE_MAX = 480; // …or larger than this
export const MIN_DRAG = 12; // a drag shorter than this is a click

/** The fixed-size square a click selects, centred on the click and kept inside `bounds` (default: the viewport). */
export function clickSquare(x: number, y: number, viewport: Viewport, bounds: Rect = { x: 0, y: 0, ...viewport }): Rect {
  const side = Math.min(Math.max(Math.min(viewport.w, viewport.h) * SQUARE_SHARE, SQUARE_MIN), SQUARE_MAX);
  const w = Math.min(side, bounds.w);
  const h = Math.min(side, bounds.h);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return { x: clamp(x - w / 2, bounds.x, bounds.x + bounds.w - w), y: clamp(y - h / 2, bounds.y, bounds.y + bounds.h - h), w, h };
}

/** The box between two drag points, clipped to `bounds`; undefined when it's too small to be a deliberate drag. */
export function dragRect(x0: number, y0: number, x1: number, y1: number, bounds: Rect): Rect | undefined {
  const left = Math.max(Math.min(x0, x1), bounds.x);
  const top = Math.max(Math.min(y0, y1), bounds.y);
  const right = Math.min(Math.max(x0, x1), bounds.x + bounds.w);
  const bottom = Math.min(Math.max(y0, y1), bounds.y + bounds.h);
  const r = { x: left, y: top, w: right - left, h: bottom - top };
  return r.w >= MIN_DRAG && r.h >= MIN_DRAG ? r : undefined;
}

/**
 * Map a viewport rect onto the screenshot. captureVisibleTab returns the viewport at device-pixel resolution
 * (e.g. 2× on a Retina screen), so scale by image size / viewport size rather than trusting devicePixelRatio.
 */
export function toImageRect(rect: Rect, viewport: Viewport, image: { width: number; height: number }): Rect {
  const sx = image.width / viewport.w;
  const sy = image.height / viewport.h;
  const x = Math.max(0, Math.round(rect.x * sx));
  const y = Math.max(0, Math.round(rect.y * sy));
  return { x, y, w: Math.max(1, Math.min(Math.round(rect.w * sx), image.width - x)), h: Math.max(1, Math.min(Math.round(rect.h * sy), image.height - y)) };
}

/** The overlap of two rects, or undefined when they don't overlap. */
export function intersect(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

export const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** A video counts when its visible part is a decent share of the screen (not a thumbnail or a tiny ad). */
export const MIN_VIDEO_SHARE = 0.12;
