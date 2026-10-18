// Owner: C. Detection → one Product (DESIGN.md §9 C: product resolution).
//   1. Candidates: Atlas Search fuzzy text on products (index `products_text`, A's), else whole-word token regex.
//   2. A printed model number with a clear lead decides on its own. Otherwise claude-opus-5-5 looks at the snap and
//      picks the exact candidate, names a product the catalog lacks (unsaved), or says there's none.
//   3. No answer → the best confident candidate, else an unsaved "unidentified" stub (#12), never the hero's verdict.
import * as fx from "@alfred/shared/fixtures";
import { Product } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { env } from "../env";
import { LOOKUP_MS, withTimeout } from "../deal/timeout";
import type { Detection } from "./detection";
import { pickProduct } from "./pick";

export type Resolution = { product: Product; identified: boolean; via: "model" | "claude" | "match" | "fixture" | "none" };

export const UNIDENTIFIED_ID = "prd_unidentified";
/** Id prefix of products Claude named that aren't in the catalog (unsaved). */
export const NEW_PRODUCT_PREFIX = "prd_new_";
/** Atlas Search index on products (title/brand/model). Created by A's `pnpm indexes`; regex is used until it exists. */
export const PRODUCT_SEARCH_INDEX = "products_text";

const STOP = new Set(["the", "and", "with", "for", "new", "a", "an", "of", "unknown", "none"]);
const MIN_SCORE = 3; // e.g. brand (2) + one title word (1)
const DECISIVE_LEAD = 2; // a model-number match must beat the runner-up by this much to skip Claude
const MAX_CANDIDATES = 8;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function queryTokens(d: Detection): string[] {
  return [...new Set([...d.ocr, ...d.objects.map((o) => o.label), d.caption ?? ""].flatMap(words))];
}

type Scored = { p: Product; score: number; anchored: boolean; modelHit: boolean };

/** Brand +2, full model +3, each matching title word +1, each unmatched title word −0.5 (so "Bambino" beats "Bambino Plus"). */
export function scoreProduct(p: Product, tokens: Set<string>): Omit<Scored, "p"> {
  const brandHit = words(p.brand).some((w) => tokens.has(w));
  const model = words(p.model);
  const modelHit = model.length > 0 && model.every((w) => tokens.has(w)); // "iPhone 17" needs both words
  const title = words(p.title);
  const titleHits = title.filter((w) => tokens.has(w)).length;
  const score = (brandHit ? 2 : 0) + (modelHit ? 3 : 0) + titleHits - 0.5 * (title.length - titleHits);
  return { score, anchored: brandHit || modelHit, modelHit };
}

const isConfident = (s: Scored) => s.anchored && s.score >= MIN_SCORE;

/** What the panel shows when nothing matched: named from the detection, never saved, no offers. */
export function unidentified(d: Detection): Product {
  const title = d.caption ?? d.objects[0]?.label ?? "Unidentified product";
  return { _id: UNIDENTIFIED_ID, title, brand: "", model: "", category: "other", source: "mock", canonicalKey: "unidentified" };
}

export async function resolveProduct(d: Detection, img?: Uint8Array): Promise<Resolution> {
  const tokens = queryTokens(d);
  const set = new Set(tokens);
  const none: Resolution = { product: unidentified(d), identified: false, via: "none" };
  if (!tokens.length) return none;

  // No DB (mock path): the hero fixture is the whole catalog.
  const fixture = (): Resolution => (isConfident({ p: fx.product, ...scoreProduct(fx.product, set) }) ? { product: fx.product, identified: true, via: "fixture" } : none);
  if (!env.MONGODB_URI) return fixture();

  let ranked: Scored[];
  try {
    ranked = await withTimeout(candidates(tokens, set), undefined, "product lookup");
  } catch (e) {
    console.warn("resolveProduct: db lookup failed:", (e as Error).message);
    return fixture();
  }

  const [top, second] = ranked;
  if (top && top.modelHit && isConfident(top) && (!second || top.score - second.score >= DECISIVE_LEAD))
    return { product: top.p, identified: true, via: "model" };

  // Mock vision means "no paid model calls"; the picker needs Claude and the image.
  if (img && env.ANTHROPIC_API_KEY && env.VISION_SOURCE !== "mock") {
    const t0 = Date.now();
    try {
      const pick = await pickProduct(img, d, ranked.slice(0, MAX_CANDIDATES).map((s) => s.p));
      console.log(`resolve: claude ${Date.now() - t0}ms · ${pick.kind}${pick.kind === "none" ? "" : ` ${pick.kind === "candidate" ? pick.product._id : pick.product.title} (${pick.confidence})`} · ${pick.reason}`);
      if (pick.kind === "candidate") return { product: pick.product, identified: true, via: "claude" };
      if (pick.kind === "new") return { product: unsaved(pick.product), identified: true, via: "claude" };
      // Claude rejected every candidate: only a model number actually read overrules it, never a name that sounds close.
      if (top && top.modelHit && isConfident(top)) return { product: top.p, identified: true, via: "model" };
      return pick.guess ? { ...none, product: unidentified({ ...d, caption: pick.guess }) } : none;
    } catch (e) {
      console.warn(`resolve: claude pick failed after ${Date.now() - t0}ms:`, (e as Error).message);
    }
  }
  return top && isConfident(top) ? { product: top.p, identified: true, via: "match" } : none;
}

/**
 * A product Claude named that the catalog doesn't have. Not written to `products`: with no offers it shows
 * "No matching prices for … yet"; SerpAPI (live prices) is what adds new products to the catalog.
 */
function unsaved(p: { brand: string; model: string; title: string; category: Product["category"] }): Product {
  const canonicalKey = slug(`${p.brand} ${p.model}`);
  return { _id: `${NEW_PRODUCT_PREFIX}${canonicalKey}`, ...p, source: "mock", canonicalKey };
}

async function candidates(tokens: string[], set: Set<string>): Promise<Scored[]> {
  const c = await collections();
  const score = (rows: unknown[]) =>
    rows.flatMap((r) => {
      const p = Product.safeParse(r);
      return p.success ? [{ p: p.data, ...scoreProduct(p.data, set) }] : [];
    });

  // Atlas Search when A's index exists; on a missing index $search errors or returns nothing, and regex takes over.
  let rows: unknown[] = [];
  try {
    rows = await c.products
      .aggregate(
        [
          { $search: { index: PRODUCT_SEARCH_INDEX, text: { query: tokens.join(" "), path: ["title", "brand", "model"], fuzzy: { maxEdits: 1 } } } },
          { $limit: 25 },
          { $project: { embedding: 0 } },
        ],
        { timeoutMS: LOOKUP_MS },
      )
      .toArray();
  } catch {
    rows = [];
  }
  if (!rows.length) {
    const re = tokens.map((t) => new RegExp(escape(t), "i"));
    rows = await c.products
      .find({ $or: [{ title: { $in: re } }, { brand: { $in: re } }, { model: { $in: re } }] }, { projection: { embedding: 0 }, timeoutMS: LOOKUP_MS })
      .limit(500)
      .toArray();
  }
  return score(rows).sort((a, b) => b.score - a.score);
}
