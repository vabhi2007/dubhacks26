// `pnpm seed` — Owner: A. Wipes and reseeds the db (DESIGN.md §7); data lives in packages/shared/src/seed.ts.
// The `alfred` db is shared by the whole team: announce in the group chat first. Refuses to wipe a non-empty db without --yes.
import "./env";
import { closeDb, collections } from "@alfred/shared/db";
import { seedDemo } from "@alfred/shared/seed";

const dbName = process.env.MONGODB_DB ?? "alfred";
const c = await collections();
if ((await c.users.estimatedDocumentCount()) > 0 && !process.argv.includes("--yes")) {
  console.error(`db "${dbName}" already has data and is shared — this wipes it for everyone. Re-run with: pnpm seed --yes`);
  await closeDb();
  process.exit(1);
}

console.log(`seeding db "${dbName}"…`);
const t0 = Date.now();
const counts = await seedDemo();
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(14)} ${v}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await closeDb();
