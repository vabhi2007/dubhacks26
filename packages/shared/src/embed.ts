// Voyage embeddings behind the Embedder interface (DESIGN.md §5, §8.4) + Atlas Search index names. Server-side only. Owner: A.
// Documents and queries must share a model: embed catalog docs with `embed()`, search text with `embedQuery()`.
import type { Embedder } from "./interfaces";
import type { Product, RewardsProgram } from "./schemas";

export const EMBEDDING_MODEL = "voyage-3.5";
export const EMBEDDING_DIMS = 1024;
const BATCH = 128;

/** Atlas Search / Vector Search index names created by `pnpm indexes` (M0: 3 per cluster, all used). */
export const SEARCH_INDEX = {
  productsText: "products_text", // $search on products: title (+ autocomplete), brand, model; category as token
  productsVector: "products_vector", // $vectorSearch on products.embedding, filter: category
  rewardsVector: "rewards_vector", // $vectorSearch on rewards_programs.embedding
} as const;

async function voyage(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  const base = process.env.VOYAGE_BASE_URL || "https://api.voyageai.com/v1";
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const r = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ input: texts.slice(i, i + BATCH), model: EMBEDDING_MODEL, input_type: inputType }),
    });
    const d = (await r.json()) as { data?: { embedding: number[]; index: number }[]; detail?: string };
    if (!r.ok || !d.data) throw new Error(`voyage: ${d.detail ?? `HTTP ${r.status}`}`);
    out.push(...d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding));
  }
  return out;
}

export const voyageEmbedder: Embedder & { embedQuery(text: string): Promise<number[]> } = {
  embed: (texts) => voyage(texts, "document"),
  embedQuery: async (text) => (await voyage([text], "query"))[0]!,
};

// The exact text embedded per doc — one definition so re-embeds and new docs (e.g. SerpAPI products) stay consistent.
export const productEmbeddingText = (p: Pick<Product, "title" | "brand" | "model" | "category">) =>
  `${p.title}. Brand: ${p.brand}. Model: ${p.model}. Category: ${p.category}.`;

export const rewardsEmbeddingText = (r: Pick<RewardsProgram, "name" | "perks">, merchantNames: string[]) =>
  `${r.name}. Merchants: ${merchantNames.join(", ")}. Perks: ${r.perks.join("; ")}.`;
