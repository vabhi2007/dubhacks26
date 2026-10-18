// `pnpm --filter @alfred/scripts setup-db` — idempotently creates collections (incl. time series) and basic indexes.
// Atlas Search / Vector indexes live in indexes.ts (need embeddings first). Owner: A.
import "./env";
import { COLLECTIONS, closeDb, getDb } from "@alfred/shared/db";

const db = await getDb();
const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

const timeSeries: Record<string, { timeField: string; metaField: string; granularity: "hours" | "minutes" }> = {
  [COLLECTIONS.transactions]: { timeField: "ts", metaField: "meta", granularity: "hours" },
  [COLLECTIONS.priceHistory]: { timeField: "ts", metaField: "meta", granularity: "hours" },
};

for (const name of Object.values(COLLECTIONS)) {
  if (existing.has(name)) continue;
  await db.createCollection(name, timeSeries[name] ? { timeseries: timeSeries[name] } : {});
  console.log(`created ${name}${timeSeries[name] ? " (time series)" : ""}`);
}

await db.collection(COLLECTIONS.agentEvents).createIndex({ userId: 1, ts: -1 });
await db.collection(COLLECTIONS.approvals).createIndex({ userId: 1, status: 1 });
await db.collection(COLLECTIONS.approvals).createIndex({ shortCode: 1 });
await db.collection(COLLECTIONS.offers).createIndex({ productId: 1, priceCents: 1 });
await db.collection(COLLECTIONS.products).createIndex({ canonicalKey: 1 }, { unique: true });
await db.collection(COLLECTIONS.wishlist).createIndex({ userId: 1, status: 1 });
await db.collection(COLLECTIONS.mandates).createIndex({ userId: 1, status: 1 });

console.log("db ready");
await closeDb();
