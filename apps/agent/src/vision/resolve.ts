// Owner: C. Detection → one Product. MVP-0: whole-word token scoring over `products`, anchored on brand or model;
// falls back to the hero fixture when there's no DB or no confident match.
// TODO(C, MVP-1): Atlas Search fuzzy match on OCR text, then claude-opus-5-5 picks the exact model (or creates one).
import * as fx from "@alfred/shared/fixtures";
import { Product } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { env } from "../env";
import { withTimeout } from "../deal/timeout";
import type { Detection } from "./index";

const STOP = new Set(["the", "and", "with", "for", "new", "a", "an", "of"]);
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

export async function resolveProduct(d: Detection): Promise<Product> {
  const tokens = queryTokens(d);
  if (!env.MONGODB_URI || tokens.length === 0) return fx.product;
  try {
    return (await withTimeout(lookup(tokens), undefined, "product lookup")) ?? fx.product;
  } catch (e) {
    console.warn("resolveProduct: db lookup failed, using fixture:", (e as Error).message);
    return fx.product;
  }
}

async function lookup(tokens: string[]): Promise<Product | undefined> {
  const c = await collections();
  const re = tokens.map((t) => new RegExp(escape(t), "i"));
  // Small catalog until Atlas Search lands, so score every candidate rather than cutting before scoring.
  const rows = await c.products
    .find({ $or: [{ title: { $in: re } }, { brand: { $in: re } }, { model: { $in: re } }] }, { projection: { embedding: 0 } })
    .limit(500)
    .toArray();
  const set = new Set(tokens);
  const ranked = rows
    .flatMap((r) => {
      const p = Product.safeParse(r);
      return p.success ? [{ p: p.data, ...scoreProduct(p.data, set) }] : [];
    })
    .filter((x) => x.anchored && x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) console.warn(`resolveProduct: no confident match for [${tokens.join(", ")}]`);
  return ranked[0]?.p;
}
