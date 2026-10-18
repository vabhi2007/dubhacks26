// Owner: C. "You might also like": nearest products in meaning, same category, via A's Atlas Vector Search index on
// product embeddings (Voyage). A catalog product searches with its stored embedding; one Claude named that isn't in
// the catalog gets its text embedded on the fly. Best effort: any failure → no similar items, never a failed snap.
import { Product } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { productEmbeddingText, SEARCH_INDEX, voyageEmbedder } from "@alfred/shared/embed";
import { env } from "../env";
import { LOOKUP_MS, withTimeout } from "./timeout";
import { UNIDENTIFIED_ID } from "../vision/resolve";

const LIMIT = 4;
const BUDGET_MS = 4_000; // runs alongside Worth-It, so this rarely adds latency

export async function findSimilar(product: Product): Promise<Product[]> {
  if (product._id === UNIDENTIFIED_ID || !env.MONGODB_URI) return [];
  try {
    return await withTimeout(search(product), BUDGET_MS, "similar items");
  } catch (e) {
    console.warn(`similar: ${product._id}:`, (e as Error).message);
    return [];
  }
}

async function search(product: Product): Promise<Product[]> {
  const c = await collections();
  const stored = await c.products.findOne({ _id: product._id }, { projection: { embedding: 1 }, timeoutMS: LOOKUP_MS });
  const queryVector = stored?.embedding?.length
    ? stored.embedding
    : env.VOYAGE_API_KEY
      ? await voyageEmbedder.embedQuery(productEmbeddingText(product))
      : undefined;
  if (!queryVector) return [];

  const rows = await c.products
    .aggregate(
      [
        {
          $vectorSearch: {
            index: SEARCH_INDEX.productsVector,
            path: "embedding",
            queryVector,
            numCandidates: 100,
            limit: LIMIT + 1, // + 1: the product itself is usually its own nearest neighbour
            filter: { category: product.category },
          },
        },
        { $match: { _id: { $ne: product._id }, canonicalKey: { $ne: product.canonicalKey } } },
        { $limit: LIMIT },
        { $project: { embedding: 0 } },
      ],
      { timeoutMS: LOOKUP_MS },
    )
    .toArray();
  return rows.flatMap((r) => {
    const p = Product.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

/** Give a newly saved product an embedding (same text as A's indexer) so it shows up in similar items too. */
export async function embedProduct(product: Product): Promise<void> {
  if (!env.VOYAGE_API_KEY || !env.MONGODB_URI) return;
  try {
    const [embedding] = await voyageEmbedder.embed([productEmbeddingText(product)]);
    if (!embedding?.length) return;
    await (await collections()).products.updateOne({ _id: product._id }, { $set: { embedding } });
  } catch (e) {
    console.warn(`similar: couldn't embed ${product._id}:`, (e as Error).message);
  }
}
