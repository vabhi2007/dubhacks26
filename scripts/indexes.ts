// `pnpm indexes` — Owner: A. Voyage embeddings for products + rewards_programs, then Atlas Search (products text) and
// Vector Search (products, rewards_programs) indexes. Idempotent. Announce before running on the shared `alfred` db.
// M0 allows 3 search indexes per *cluster* (all dbs): this needs exactly 3, and refuses to go over.
//   --dry-run     plan only: cluster-wide index census + docs to embed. No writes, no Voyage calls.
//   --embed-only  embed missing docs and check nearest neighbours locally; no indexes (safe on scratch dbs).
//   --reembed     re-embed docs that already have an embedding (e.g. after changing productEmbeddingText).
import "./env";
import { closeDb, collections, getDb } from "@alfred/shared/db";
import { MongoClient, type Document } from "mongodb";
import { EMBEDDING_DIMS, SEARCH_INDEX, productEmbeddingText, rewardsEmbeddingText, voyageEmbedder } from "@alfred/shared/embed";

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const EMBED_ONLY = args.has("--embed-only");
const REEMBED = args.has("--reembed");
const M0_LIMIT = 3;

const vector = (extra: Document[] = []) => ({ fields: [{ type: "vector", path: "embedding", numDimensions: EMBEDDING_DIMS, similarity: "cosine" }, ...extra] });
const DEFS = [
  {
    coll: "products", name: SEARCH_INDEX.productsText, type: "search",
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          title: [{ type: "string" }, { type: "autocomplete", tokenization: "edgeGram", minGrams: 2, maxGrams: 15, foldDiacritics: true }],
          brand: { type: "string" },
          model: { type: "string" },
          category: { type: "token" },
        },
      },
    },
  },
  { coll: "products", name: SEARCH_INDEX.productsVector, type: "vectorSearch", definition: vector([{ type: "filter", path: "category" }]) },
  { coll: "rewards_programs", name: SEARCH_INDEX.rewardsVector, type: "vectorSearch", definition: vector() },
];

const SMOKE = {
  text: "brevile bambino", // OCR-ish typo
  products: "compact espresso machine for a small kitchen",
  rewards: "I buy coffee at Starbucks most mornings",
};

type Found = { db: string; coll: string; name: string; status?: string; queryable?: boolean; latestDefinition?: Document };

/** Every search index on the cluster (they all count toward M0's limit). */
async function census(): Promise<Found[]> {
  const client = await new MongoClient(process.env.MONGODB_URI!).connect();
  const target = (await getDb()).databaseName;
  let dbs = [target];
  try {
    dbs = (await client.db("admin").admin().listDatabases({ nameOnly: true })).databases.map((d) => d.name).filter((n) => !["admin", "local", "config"].includes(n));
  } catch {
    console.warn("  (can't list databases — census covers only the target db)");
  }
  const found: Found[] = [];
  for (const dbName of dbs) {
    const db = client.db(dbName);
    for (const { name, type } of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (name.startsWith("system.") || type === "timeseries") continue;
      try {
        for (const ix of await db.collection(name).listSearchIndexes().toArray()) found.push({ db: dbName, coll: name, ...(ix as Omit<Found, "db" | "coll">) });
      } catch {
        /* collection type without search support */
      }
    }
  }
  await client.close();
  return found;
}

/** `have` contains everything in `want` (Atlas adds defaults to stored definitions). */
const covers = (want: unknown, have: unknown): boolean =>
  want === null || typeof want !== "object"
    ? want === have
    : Array.isArray(want)
      ? Array.isArray(have) && want.length === have.length && want.every((w, i) => covers(w, have[i]))
      : !!have && typeof have === "object" && Object.entries(want).every(([k, v]) => covers(v, (have as Document)[k]));

async function embed() {
  const c = await collections();
  const filter = REEMBED ? {} : { embedding: { $exists: false } };
  const [products, programs, merchants] = await Promise.all([
    c.products.find(filter, { projection: { embedding: 0 } }).toArray(),
    c.rewardsPrograms.find(filter, { projection: { embedding: 0 } }).toArray(),
    c.merchants.find({}, { projection: { name: 1 } }).toArray(),
  ]);
  console.log(`embed: ${products.length} products, ${programs.length} rewards programs${REEMBED ? " (re-embed all)" : " missing embeddings"}`);
  if (DRY) return;
  const names = new Map(merchants.map((m) => [m._id, m.name]));
  if (products.length) {
    const vs = await voyageEmbedder.embed(products.map(productEmbeddingText));
    await c.products.bulkWrite(products.map((p, i) => ({ updateOne: { filter: { _id: p._id }, update: { $set: { embedding: vs[i]! } } } })));
  }
  if (programs.length) {
    const vs = await voyageEmbedder.embed(programs.map((r) => rewardsEmbeddingText(r, r.merchantIds.map((id) => names.get(id) ?? id))));
    await c.rewardsPrograms.bulkWrite(programs.map((r, i) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { embedding: vs[i]! } } } })));
  }
}

/** Nearest neighbours computed in-process — checks embedding quality without spending index slots. */
async function localSmoke() {
  const c = await collections();
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0) / (Math.hypot(...a) * Math.hypot(...b));
  for (const [label, coll, q] of [["products", c.products, SMOKE.products], ["rewards", c.rewardsPrograms, SMOKE.rewards]] as const) {
    const qv = await voyageEmbedder.embedQuery(q);
    const docs = await (coll as typeof c.products).find({ embedding: { $exists: true } }).toArray();
    const top = docs.map((d) => ({ d, s: cos(qv, d.embedding!) })).sort((a, b) => b.s - a.s).slice(0, 3);
    console.log(`  local ${label} "${q}" → ${top.map((t) => `${"title" in t.d ? t.d.title : (t.d as unknown as { name: string }).name} (${t.s.toFixed(2)})`).join(" · ")}`);
  }
}

async function ensureIndexes(existing: Found[]) {
  const db = await getDb();
  const mine = (d: (typeof DEFS)[number]) => existing.find((f) => f.db === db.databaseName && f.coll === d.coll && f.name === d.name);
  const toCreate = DEFS.filter((d) => !mine(d));
  if (existing.length + toCreate.length > M0_LIMIT) {
    throw new Error(`would need ${existing.length + toCreate.length} search indexes on the cluster (M0 limit ${M0_LIMIT}). Existing: ${existing.map((f) => `${f.db}.${f.coll}/${f.name}`).join(", ")}`);
  }
  for (const d of DEFS) {
    const found = mine(d);
    if (!found) {
      console.log(`  create ${d.coll}/${d.name} (${d.type})`);
      if (!DRY) await db.collection(d.coll).createSearchIndex({ name: d.name, type: d.type, definition: d.definition });
    } else if (!covers(d.definition, found.latestDefinition)) {
      console.log(`  update ${d.coll}/${d.name}`);
      if (!DRY) await db.collection(d.coll).updateSearchIndex(d.name, d.definition);
    } else console.log(`  ok     ${d.coll}/${d.name} (${found.status})`);
  }
  if (DRY) return;
  for (const d of DEFS) {
    for (let waited = 0; ; waited += 5) {
      const [ix] = (await db.collection(d.coll).listSearchIndexes(d.name).toArray()) as Found[];
      if (ix?.queryable && ix.status === "READY") break;
      if (waited >= 300) throw new Error(`${d.name} not ready after 5 min (status ${ix?.status})`);
      if (waited % 30 === 0) console.log(`  waiting for ${d.name} (${ix?.status ?? "?"})…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function atlasSmoke() {
  const c = await collections();
  const text = await c.products
    .aggregate<{ title: string; score: number }>([
      { $search: { index: SEARCH_INDEX.productsText, text: { query: SMOKE.text, path: ["title", "brand", "model"], fuzzy: { maxEdits: 2 } } } },
      { $limit: 3 },
      { $project: { _id: 0, title: 1, score: { $meta: "searchScore" } } },
    ])
    .toArray();
  console.log(`  $search "${SMOKE.text}" → ${text.map((t) => t.title).join(" · ")}`);
  const vec = async (coll: "products" | "rewardsPrograms", index: string, q: string, field: string) =>
    (await c[coll]
      .aggregate<Document>([
        { $vectorSearch: { index, path: "embedding", queryVector: await voyageEmbedder.embedQuery(q), numCandidates: 100, limit: 3 } },
        { $project: { _id: 0, [field]: 1 } },
      ])
      .toArray()).map((d) => d[field]).join(" · ");
  console.log(`  $vectorSearch "${SMOKE.products}" → ${await vec("products", SEARCH_INDEX.productsVector, SMOKE.products, "title")}`);
  console.log(`  $vectorSearch "${SMOKE.rewards}" → ${await vec("rewardsPrograms", SEARCH_INDEX.rewardsVector, SMOKE.rewards, "name")}`);
}

const dbName = (await getDb()).databaseName;
console.log(`indexes: db "${dbName}"${DRY ? " — DRY RUN" : ""}${EMBED_ONLY ? " — embed only" : ""}`);
const existing = await census();
console.log(`cluster search indexes (${existing.length}/${M0_LIMIT}): ${existing.map((f) => `${f.db}.${f.coll}/${f.name}[${f.status}]`).join(", ") || "none"}`);
await embed();
if (EMBED_ONLY) {
  if (!DRY) await localSmoke();
} else {
  await ensureIndexes(existing);
  if (!DRY) await atlasSmoke();
}
await closeDb();
