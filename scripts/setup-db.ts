// `pnpm --filter @alfred/scripts setup-db` — idempotently creates collections (incl. time series) and basic indexes.
// Atlas Search / Vector indexes live in indexes.ts (need embeddings first). Owner: A.
import "./env";
import { closeDb, getDb } from "@alfred/shared/db";
import { ensureSchema } from "@alfred/shared/seed";

for (const name of await ensureSchema(await getDb())) console.log(`created ${name}`);
console.log("db ready");
await closeDb();
