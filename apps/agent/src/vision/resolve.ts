// Owner: C. Detection → one Product. MVP-0: token regex over `products`; falls back to the hero fixture.
// TODO(C, MVP-1): Atlas Search fuzzy match on OCR text, then claude-opus-5-5 picks the exact model (or creates one).
import * as fx from "@alfred/shared/fixtures";
import type { Product } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { env } from "../env";
import type { Detection } from "./index";

const STOP = new Set(["the", "and", "with", "for", "new", "a", "an", "of"]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function queryTokens(d: Detection): string[] {
  const words = [...d.ocr, ...d.objects.map((o) => o.label), d.caption ?? ""]
    .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(words)];
}

export async function resolveProduct(d: Detection): Promise<Product> {
  const tokens = queryTokens(d);
  if (!env.MONGODB_URI || tokens.length === 0) return fx.product;
  try {
    const c = await collections();
    const re = tokens.map((t) => new RegExp(escape(t), "i"));
    const candidates = await c.products
      .find({ $or: [{ title: { $in: re } }, { brand: { $in: re } }, { model: { $in: re } }] }, { projection: { embedding: 0 } })
      .limit(25)
      .toArray();
    const score = (p: Product) => {
      const hay = `${p.title} ${p.brand} ${p.model}`.toLowerCase();
      return tokens.filter((t) => hay.includes(t)).length;
    };
    const best = candidates.sort((a, b) => score(b) - score(a))[0];
    return best ?? fx.product;
  } catch (e) {
    console.warn("resolveProduct: db lookup failed, using fixture:", (e as Error).message);
    return fx.product;
  }
}
