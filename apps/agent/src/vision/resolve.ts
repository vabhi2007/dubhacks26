// Owner: C. Detection → one Product. Whole-word token scoring over `products`, anchored on brand or model.
// No confident match → an unsaved "unidentified" stub (#12), never the hero product's verdict.
// TODO(C, MVP-1): Atlas Search fuzzy match on OCR text, then claude-opus-5-5 picks the exact model (or creates one).
import * as fx from "@alfred/shared/fixtures";
import { Product } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { env } from "../env";
import { LOOKUP_MS, withTimeout } from "../deal/timeout";
import type { Detection } from "./detection";

export type Resolution = { product: Product; identified: boolean };

export const UNIDENTIFIED_ID = "prd_unidentified";

const STOP = new Set(["the", "and", "with", "for", "new", "a", "an", "of", "unknown", "none"]);
const MIN_SCORE = 3; // e.g. brand (2) + one title word (1)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

export function queryTokens(d: Detection): string[] {
  return [...new Set([...d.ocr, ...d.objects.map((o) => o.label), d.caption ?? ""].flatMap(words))];
}

/** Brand +2, model +3, each matching title word +1, each unmatched title word −0.5 (so "Bambino" beats "Bambino Plus"). */
export function scoreProduct(p: Product, tokens: Set<string>) {
  const brandHit = words(p.brand).some((w) => tokens.has(w));
  const modelHit = words(p.model).some((w) => tokens.has(w));
  const title = words(p.title);
  const titleHits = title.filter((w) => tokens.has(w)).length;
  const score = (brandHit ? 2 : 0) + (modelHit ? 3 : 0) + titleHits - 0.5 * (title.length - titleHits);
  return { score, anchored: brandHit || modelHit };
}

const confident = (p: Product, tokens: Set<string>) => {
  const s = scoreProduct(p, tokens);
  return s.anchored && s.score >= MIN_SCORE ? s.score : undefined;
};

/** What the panel shows when nothing matched: named from the detection, never saved, no offers. */
export function unidentified(d: Detection): Product {
  const title = d.caption ?? d.objects[0]?.label ?? "Unidentified product";
  return { _id: UNIDENTIFIED_ID, title, brand: "", model: "", category: "other", source: "mock", canonicalKey: "unidentified" };
}

export async function resolveProduct(d: Detection): Promise<Resolution> {
  const tokens = queryTokens(d);
  const set = new Set(tokens);
  const none = { product: unidentified(d), identified: false };
  if (!tokens.length) return none;
  // No DB (mock path): the hero fixture is the whole catalog.
  if (!env.MONGODB_URI) return confident(fx.product, set) !== undefined ? { product: fx.product, identified: true } : none;
  try {
    const p = await withTimeout(lookup(tokens, set), undefined, "product lookup");
    return p ? { product: p, identified: true } : none;
  } catch (e) {
    console.warn("resolveProduct: db lookup failed:", (e as Error).message);
    return confident(fx.product, set) !== undefined ? { product: fx.product, identified: true } : none;
  }
}

async function lookup(tokens: string[], set: Set<string>): Promise<Product | undefined> {
  const c = await collections();
  const re = tokens.map((t) => new RegExp(escape(t), "i"));
  // Small catalog until Atlas Search lands, so score every candidate rather than cutting before scoring.
  const rows = await c.products
    .find({ $or: [{ title: { $in: re } }, { brand: { $in: re } }, { model: { $in: re } }] }, { projection: { embedding: 0 }, timeoutMS: LOOKUP_MS })
    .limit(500)
    .toArray();
  const ranked = rows
    .flatMap((r) => {
      const p = Product.safeParse(r);
      const score = p.success ? confident(p.data, set) : undefined;
      return p.success && score !== undefined ? [{ p: p.data, score }] : [];
    })
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) console.warn(`resolveProduct: no confident match for [${tokens.join(", ")}]`);
  return ranked[0]?.p;
}
