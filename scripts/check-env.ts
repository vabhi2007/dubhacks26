// `pnpm check:env` — verifies each key in .env actually works. Uses free/no-quota endpoints where possible.
import "./env";
import Anthropic from "@anthropic-ai/sdk";
import { MongoClient } from "mongodb";

type Result = { name: string; required: boolean; ok: boolean | null; detail: string };
const results: Result[] = [];
const has = (k: string) => Boolean(process.env[k]?.trim());

async function check(name: string, required: boolean, keys: string[], fn?: () => Promise<string>) {
  if (!keys.every(has)) return results.push({ name, required, ok: false, detail: `missing ${keys.filter((k) => !has(k)).join(", ")}` });
  if (!fn) return results.push({ name, required, ok: null, detail: "set (not live-tested)" });
  try {
    results.push({ name, required, ok: true, detail: await fn() });
  } catch (e) {
    results.push({ name, required, ok: false, detail: (e as Error).message.slice(0, 160) });
  }
}

await check("MongoDB Atlas", true, ["MONGODB_URI"], async () => {
  const c = new MongoClient(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 8000 });
  try {
    await c.connect();
    await c.db(process.env.MONGODB_DB ?? "alfred").command({ ping: 1 });
    return `connected (db: ${process.env.MONGODB_DB ?? "alfred"})`;
  } finally {
    await c.close();
  }
});

await check("Anthropic", true, ["ANTHROPIC_API_KEY"], async () => {
  const m = await new Anthropic().models.retrieve("claude-opus-5-5");
  return `ok (${m.id})`;
});

await check("SerpAPI", true, ["SERPAPI_KEY"], async () => {
  const r = await fetch(`https://serpapi.com/account.json?api_key=${process.env.SERPAPI_KEY}`);
  const d = (await r.json()) as { error?: string; plan_searches_left?: number; plan_name?: string };
  if (d.error) throw new Error(d.error);
  return `${d.plan_name}, ${d.plan_searches_left} searches left`;
});

await check("Voyage AI", true, ["VOYAGE_API_KEY"], async () => {
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ input: ["ping"], model: "voyage-3.5-lite" }),
  });
  const d = (await r.json()) as { data?: { embedding: number[] }[]; detail?: string };
  if (!r.ok) throw new Error(d.detail ?? `HTTP ${r.status}`);
  return `ok (dim ${d.data?.[0]?.embedding.length})`;
});

await check("Perceptron", true, ["PERCEPTRON_API_KEY"]); // TODO(C): live test once API shape is known (workshop)
await check("Photon", true, ["PHOTON_API_KEY", "PHOTON_PROJECT_ID"]); // TODO(A): live test via spectrum-ts
await check("cloudflared tunnel", false, ["PUBLIC_TUNNEL_URL"]);
await check("Atlas Charts embed", false, ["ATLAS_CHARTS_BASE_URL", "ATLAS_CHARTS_SPEND_CHART_ID"]);
await check("Voice (Retell or ElevenLabs)", false, ["RETELL_API_KEY"]);

const icon = (r: Result) => (r.ok === true ? "✅" : r.ok === null ? "🟡" : r.required ? "❌" : "⚪️");
for (const r of results) console.log(`${icon(r)} ${r.name.padEnd(30)} ${r.detail}`);
console.log(`\nflags: PRICE_SOURCE=${process.env.PRICE_SOURCE} VISION_SOURCE=${process.env.VISION_SOURCE} MESSENGER=${process.env.MESSENGER}`);
process.exit(results.some((r) => r.required && r.ok === false) ? 1 : 0);
