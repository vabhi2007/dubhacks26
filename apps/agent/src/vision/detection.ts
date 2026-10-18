// Owner: C. Shared prompt, schema and normalization for every Vision provider (Perceptron, Claude).
import { z } from "zod";
import type { Vision } from "@alfred/shared";

export type Detection = Awaited<ReturnType<Vision["detect"]>>;
export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export const EMPTY_DETECTION: Detection = { objects: [], ocr: [] };

export const DETECT_PROMPT = `You identify products for a shopping assistant. Find the single main product a shopper would want to buy in this image (ignore accessories, background, page UI).
Reply with ONLY a JSON object, no prose:
{"objects":[{"label":"<generic product category, e.g. espresso machine>","bbox":{"x":0,"y":0,"w":0,"h":0},"conf":0.0}],"ocr":["<each brand, model number or price visible, verbatim>"],"caption":"<brand + exact model you believe this is, e.g. Breville Bambino Plus BES500>"}
- objects: the main product first, at most 3. bbox normalized 0-1, x,y = top-left corner.
- ocr: only text actually printed in the image. [] if none.
- caption: your best identification even if the model name isn't printed; say "unknown" for parts you can't tell. If there is no product, objects is [] and caption is "none".`;

/** Strict shape: Claude's structured output (must stay plain JSON-schema). */
export const DetectionSchema = z.object({
  objects: z.array(z.object({ label: z.string(), bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }), conf: z.number() })),
  ocr: z.array(z.string()),
  caption: z.string(),
});

// Lenient shape for free-text JSON (Perceptron): numbers as strings, missing ocr/caption.
const num = z.coerce.number().catch(0);
const LenientDetection = z.object({
  objects: z.array(z.object({ label: z.string(), bbox: z.object({ x: num, y: num, w: num, h: num }), conf: num })).catch([]),
  ocr: z.array(z.string()).catch([]),
  caption: z.string().catch(""),
});

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Models disagree on box scale (Perceptron answers in 0–1 or 0–1000); normalize to 0–1, drop "none"/"unknown" captions. */
export function normalize(d: z.infer<typeof DetectionSchema>): Detection {
  const objects = d.objects.slice(0, 3).map(({ label, bbox, conf }) => {
    const scale = Math.max(bbox.x, bbox.y, bbox.w, bbox.h) > 1 ? 1000 : 1;
    return {
      label: label.trim(),
      bbox: { x: clamp01(bbox.x / scale), y: clamp01(bbox.y / scale), w: clamp01(bbox.w / scale), h: clamp01(bbox.h / scale) },
      conf: clamp01(conf),
    };
  });
  const caption = d.caption.trim();
  return {
    objects: objects.filter((o) => o.label),
    ocr: d.ocr.map((s) => s.trim()).filter(Boolean),
    ...(caption && !/^(none|unknown)$/i.test(caption) && { caption }),
  };
}

/** Pull the JSON object out of a chat reply that may be wrapped in a ```json fence or prose. */
export function parseDetectionText(text: string): Detection {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return normalize(LenientDetection.parse(JSON.parse(text.slice(start, end + 1))));
}

/** Sniff the image type from magic bytes; undefined = not an image we can send to a vision model. */
export function sniffMime(img: Uint8Array): ImageMime | undefined {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => img[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return undefined;
}

export const toBase64 = (img: Uint8Array) => Buffer.from(img.buffer, img.byteOffset, img.byteLength).toString("base64");
