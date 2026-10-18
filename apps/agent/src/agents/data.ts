// Owner: B. Read-side data access for the agents. Every agent reads seed data through these functions only.
import * as fx from "@alfred/shared/fixtures";
import { collections } from "@alfred/shared/db";
import type { Category, Device, Offer, Product, TradeInCurve, User, Verdict } from "@alfred/shared";
import { env } from "../env";
import { withTimeout } from "../deal/timeout";

const DAY = 86_400_000;

// Where seed data (products, offers, users, transactions, price history) comes from.
// A's seed is on main, so this reads Mongo; set "fixtures" to work offline. Fixtures remain the fallback for anything Mongo lacks.
const SEED_SOURCE = "mongo" as "fixtures" | "mongo";

export const hasDb = () => Boolean(env.MONGODB_URI);

type Cols = Awaited<ReturnType<typeof collections>>;

/** Seed-data read: Mongo only when SEED_SOURCE is "mongo"; undefined → caller uses fixtures. */
const fromSeed = <T>(fn: (c: Cols) => Promise<T>) => (SEED_SOURCE === "mongo" ? tryDb(fn) : Promise.resolve(undefined));

// An unreachable Atlas would otherwise make every read wait out the driver's 30s server selection.
// Each read is capped at DB_READ_MS; after a failure, reads skip Mongo for DB_BACKOFF_MS so one request
// doesn't pay the cap once per read.
const DB_READ_MS = 3_000;
const DB_BACKOFF_MS = 30_000;
let dbDownUntil = 0;

/** Read of data the agents write themselves (verdicts, wishlist) — always Mongo when configured.
 *  undefined = Mongo not configured, unreachable, or failed (callers fall back); a successful empty read is returned as-is. */
async function tryDb<T>(fn: (c: Cols) => Promise<T>): Promise<T | undefined> {
  if (!hasDb() || Date.now() < dbDownUntil) return undefined;
  try {
    return await withTimeout((async () => fn(await collections()))(), DB_READ_MS, "agents db read");
  } catch (e) {
    const err = e as Error;
    // Back off only when Mongo looks unreachable; a single bad query shouldn't switch every read to fixtures.
    const unreachable = /timed out|ServerSelection|Network|ECONNREFUSED|ENOTFOUND/i.test(`${err.name} ${err.message}`);
    if (unreachable) dbDownUntil = Date.now() + DB_BACKOFF_MS;
    console.warn(`[agents] db read failed${unreachable ? `, using fixtures for ${DB_BACKOFF_MS / 1000}s` : ""}:`, err.message);
    return undefined;
  }
}

// ---------- products & offers ----------

export async function getProduct(productId: string): Promise<Product | undefined> {
  const p = await fromSeed((c) => c.products.findOne({ _id: productId }, { projection: { embedding: 0 } }));
  return p ?? (productId === fx.product._id ? fx.product : undefined);
}

export async function getProducts(ids: string[]): Promise<Product[]> {
  if (!ids.length) return [];
  const ps = (await fromSeed((c) => c.products.find({ _id: { $in: ids } }, { projection: { embedding: 0 } }).toArray())) ?? [];
  const found = new Set(ps.map((p) => p._id));
  return [...ps, ...(ids.includes(fx.product._id) && !found.has(fx.product._id) ? [fx.product] : [])];
}

// Filler words in chat ("is the X worth it for me?") that would otherwise count against a match.
const STOPWORDS = new Set(
  ("a an and any are be buy can cost could do does for from get good hey hi how i im is it its me much my need of on or " +
   "price really should show tell than that the this to want was what whats will with worth would you your").split(" "),
);
const words = (s: string) => s.toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? [];

/**
 * Catalog text search for chat ("is the Bambino worth it for me?"). Ranked by how many query words start a word in the
 * title/brand/model/key, then by shorter titles (so "Bambino" beats "Bambino Plus"). `strict` (offline fallback) only
 * returns a product that matches at least half the query words.
 */
export async function searchProducts(query: string, limit = 5, opts: { strict?: boolean } = {}): Promise<Product[]> {
  const q = [...new Set(words(query).filter((w) => w.length > 1 && !STOPWORDS.has(w)))];
  if (!q.length) return [];
  // Alphanumeric words only, so they're safe inside a regex.
  const rows = await fromSeed((c) =>
    c.products
      .find({ $or: q.flatMap((w) => ["title", "brand", "model", "canonicalKey"].map((f) => ({ [f]: { $regex: `\\b${w}`, $options: "i" } }))) }, { projection: { embedding: 0 } })
      .limit(200)
      .toArray(),
  );
  const ranked = (rows ?? [fx.product])
    .map((p) => {
      const toks = words(`${p.title} ${p.brand} ${p.model} ${p.canonicalKey.replace(/-/g, " ")}`);
      return { p, hits: q.filter((w) => toks.some((t) => t.startsWith(w))).length, len: words(p.title).length };
    })
    .filter((r) => r.hits > 0 && (!opts.strict || r.hits >= Math.ceil(q.length / 2)))
    .sort((a, b) => b.hits - a.hits || a.len - b.len);
  return ranked.slice(0, limit).map((r) => r.p);
}

export async function getOffers(productId: string): Promise<Offer[]> {
  const o = await fromSeed((c) => c.offers.find({ productId }).toArray());
  if (o?.length) return o;
  return fx.offers.filter((x) => x.productId === productId);
}

/** Cheapest exact-match new US offer; falls back to cheapest exact match, then cheapest variant. Never a different product. */
export function bestOffer(offers: Offer[]): Offer | undefined {
  const byPrice = (a: Offer, b: Offer) => a.priceCents - b.priceCents;
  const exact = offers.filter((o) => o.matched === "exact");
  return (
    exact.filter((o) => o.condition === "new" && o.region === "US").sort(byPrice)[0] ??
    exact.sort(byPrice)[0] ??
    offers.filter((o) => o.matched === "variant").sort(byPrice)[0]
  );
}

// ---------- user & spend profile ----------

const FALLBACK_USER: User = {
  _id: "u_maya",
  name: "Maya",
  phone: "",
  settings: { confirmAboveCents: 50_00, callAboveCents: 500_00, monthlyBudgets: { kitchen: 150_00, electronics: 200_00, coffee: 60_00 } },
};

export async function getUser(userId: string): Promise<User> {
  return (await fromSeed((c) => c.users.findOne({ _id: userId }))) ?? { ...FALLBACK_USER, _id: userId };
}

export type CategorySpend = {
  category: Category;
  totalCents: number;
  txCount: number;
  topMerchants: { name: string; totalCents: number; txCount: number }[];
};

// Mirrors the hero persona (DESIGN.md §7) so verdicts stay sensible before the seed lands.
const FALLBACK_SPEND: CategorySpend[] = [
  { category: "coffee", totalCents: 640_00, txCount: 128, topMerchants: [{ name: "Starbucks", totalCents: 410_00, txCount: 82 }, { name: "Cafe Allegro", totalCents: 230_00, txCount: 46 }] },
  { category: "groceries", totalCents: 4_200_00, txCount: 96, topMerchants: [{ name: "QFC", totalCents: 2_600_00, txCount: 60 }] },
  { category: "dining", totalCents: 1_850_00, txCount: 70, topMerchants: [] },
  { category: "home", totalCents: 1_100_00, txCount: 30, topMerchants: [{ name: "Target", totalCents: 1_100_00, txCount: 30 }] },
  { category: "subscriptions", totalCents: 420_00, txCount: 24, topMerchants: [{ name: "Spotify", totalCents: 144_00, txCount: 12 }, { name: "Netflix", totalCents: 276_00, txCount: 12 }] },
  { category: "transport", totalCents: 960_00, txCount: 48, topMerchants: [{ name: "Uber", totalCents: 960_00, txCount: 48 }] },
  { category: "phone", totalCents: 840_00, txCount: 12, topMerchants: [{ name: "T-Mobile", totalCents: 840_00, txCount: 12 }] },
];

/** 12-month spend by category with top merchants. Positive amounts only (refunds ignored). */
export async function spendByCategory(userId: string, now = new Date()): Promise<CategorySpend[]> {
  const rows = await fromSeed(async (c) => {
    const agg = await c.transactions
      .aggregate<{ _id: { category: Category; merchantId: string }; total: number; n: number }>([
        { $match: { "meta.userId": userId, ts: { $gte: new Date(now.getTime() - 365 * DAY), $lte: now }, amountCents: { $gt: 0 } } },
        { $group: { _id: { category: "$meta.category", merchantId: "$meta.merchantId" }, total: { $sum: "$amountCents" }, n: { $sum: 1 } } },
      ])
      .toArray();
    if (!agg.length) return [];
    const ids = [...new Set(agg.map((r) => r._id.merchantId))];
    const names = new Map((await c.merchants.find({ _id: { $in: ids } }).toArray()).map((m) => [m._id, m.name]));
    const byCat = new Map<Category, CategorySpend>();
    for (const r of agg) {
      const cs = byCat.get(r._id.category) ?? { category: r._id.category, totalCents: 0, txCount: 0, topMerchants: [] };
      cs.totalCents += r.total;
      cs.txCount += r.n;
      cs.topMerchants.push({ name: names.get(r._id.merchantId) ?? r._id.merchantId, totalCents: r.total, txCount: r.n });
      byCat.set(r._id.category, cs);
    }
    return [...byCat.values()].map((cs) => ({ ...cs, topMerchants: cs.topMerchants.sort((a, b) => b.totalCents - a.totalCents).slice(0, 3) }));
  });
  return (rows?.length ? rows : [...FALLBACK_SPEND]).sort((a, b) => b.totalCents - a.totalCents);
}

/** This calendar month's spend in one category (for budget headroom). */
export async function monthToDateSpend(userId: string, category: Category, now = new Date()): Promise<number> {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const r = await fromSeed((c) =>
    c.transactions
      .aggregate<{ total: number }>([
        { $match: { "meta.userId": userId, "meta.category": category, ts: { $gte: start, $lte: now }, amountCents: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$amountCents" } } },
      ])
      .toArray(),
  );
  return r?.[0]?.total ?? 0;
}

// ---------- price history ----------

export type PriceStats = {
  days: number;
  points: number;
  minCents: number;
  maxCents: number;
  medianCents: number;
  /** The price you can realistically wait for: median of the dipped weeks' lows when it dipped in ≥ 2 weeks, else p25 of weekly lows. */
  typicalLowCents: number;
  /** How many calendar weeks (Mon–Sun) dipped ≥5% below `refCents`. */
  dipsBelowRef: number;
};

/** Dipped weeks needed before a drop counts as expected. */
export const MIN_DIPS = 2;

/** 90-day stats for the given sellers only — mixing in used/refurb sellers would make every week look like a "dip". */
export async function priceStats(productId: string, refCents: number, sellers: string[], now = new Date()): Promise<PriceStats | undefined> {
  const since = new Date(now.getTime() - 90 * DAY);
  const pts = await fromSeed((c) =>
    c.priceHistory
      .find({ "meta.productId": productId, "meta.seller": { $in: sellers }, ts: { $gte: since, $lte: now } })
      .sort({ ts: 1 })
      .toArray(),
  );
  // Synthetic history only when Mongo isn't the source (fixtures mode, unconfigured, or unreachable). If Mongo answered
  // with no points for these sellers, return undefined so the caller can try peer sellers.
  const series = pts ? pts.map((p) => ({ ts: p.ts.getTime(), priceCents: p.priceCents })) : fallbackHistory(productId, now);
  if (!series.length) return undefined;

  const prices = series.map((p) => p.priceCents).sort((a, b) => a - b);
  const median = (xs: number[]) => xs[Math.floor(xs.length / 2)]!;
  // Bucket by calendar week starting Monday (epoch day 4 = Mon 1970-01-05) so a Sat+Sun sale counts once.
  const weeklyLows = new Map<number, number>();
  for (const p of series) {
    const w = Math.floor((p.ts - 4 * DAY) / (7 * DAY));
    weeklyLows.set(w, Math.min(weeklyLows.get(w) ?? Infinity, p.priceCents));
  }
  const lows = [...weeklyLows.values()].sort((a, b) => a - b);
  // Infrequent sales would vanish under a plain median, so measure the dips themselves.
  const dips = lows.filter((l) => l <= refCents * 0.95);
  return {
    days: 90,
    points: series.length,
    minCents: prices[0]!,
    maxCents: prices.at(-1)!,
    medianCents: median(prices),
    // One sale week is an anomaly, not a pattern to wait for.
    typicalLowCents: dips.length >= MIN_DIPS ? median(dips) : lows[Math.floor(lows.length / 4)]!,
    dipsBelowRef: dips.length,
  };
}

// Synthetic 90-day series for the hero product only: ~$179 with weekend dips to ~$149.
function fallbackHistory(productId: string, now: Date) {
  if (productId !== fx.product._id) return [];
  return Array.from({ length: 90 }, (_, i) => {
    const ts = now.getTime() - (89 - i) * DAY;
    const dow = new Date(ts).getDay();
    const weekend = dow === 0 || dow === 6;
    const dip = weekend && Math.floor((ts - 4 * DAY) / (7 * DAY)) % 4 === 0; // one weekend sale every 4 weeks
    return { ts, priceCents: dip ? 149_00 : 179_00 + ((i * 37) % 3) * 5_00 };
  });
}

// ---------- devices & trade-in (Timekeeper) ----------

// Mirror the seed's hero device so Timekeeper's mock path tells the same "wait 4 months" story.
const FALLBACK_DEVICE: Omit<Device, "userId"> = {
  _id: "dev_maya", model: "iPhone 15", purchasedAt: new Date("2025-02-16T00:00:00Z"), financingRemainingCents: 210_00, batteryHealthPct: 88, storageUsedPct: 71,
};
const FALLBACK_CURVE: TradeInCurve = {
  _id: "tic_iphone_15", model: "iPhone 15",
  points: [310, 300, 290, 280, 270, 210, 200, 190, 180, 170, 160, 150, 140].map((d, month) => ({ month, valueCents: d * 100 })),
};

export async function getDevice(userId: string): Promise<Device | undefined> {
  const d = await fromSeed((c) => c.devices.findOne({ userId }));
  if (d !== undefined) return d ?? undefined;
  return userId === "u_maya" ? { ...FALLBACK_DEVICE, userId } : undefined;
}

/** Trade-in value by month from now (month 0 = today). */
export async function getTradeInCurve(model: string): Promise<TradeInCurve | undefined> {
  const t = await fromSeed((c) => c.tradeinCurves.findOne({ model }));
  if (t !== undefined) return t ?? undefined;
  return model === FALLBACK_CURVE.model ? FALLBACK_CURVE : undefined;
}

// ---------- past purchases (duplicate-ownership check) ----------

export type PastPurchase = { productId: string; title: string; amountCents: number; ts: Date };

/** Orders in the same category over the last 12 months. Orders are written at runtime by purchase(), so always Mongo;
 *  products resolve through getProducts so they follow SEED_SOURCE. */
export async function recentPurchases(userId: string, category: Category, now = new Date()): Promise<PastPurchase[]> {
  const orders = await tryDb((c) => c.orders.find({ userId, ts: { $gte: new Date(now.getTime() - 365 * DAY) } }).sort({ ts: -1 }).toArray());
  if (!orders?.length) return [];
  const products = await getProducts([...new Set(orders.map((o) => o.productId))]);
  const byId = new Map(products.filter((p) => p.category === category).map((p) => [p._id, p]));
  return orders
    .filter((o) => byId.has(o.productId))
    .map((o) => ({ productId: o.productId, title: byId.get(o.productId)!.title, amountCents: o.amountCents, ts: o.ts }));
}

// ---------- verdicts ----------

// Recent verdicts in process memory, so /verdicts/:id works with no DB (or when a write failed).
const recentVerdicts = new Map<string, Verdict>();

export function rememberVerdict(v: Verdict) {
  recentVerdicts.set(v._id, v);
  if (recentVerdicts.size > 500) recentVerdicts.delete(recentVerdicts.keys().next().value!);
}

/** A user's verdicts, newest first. Mongo when it answers (even if empty); otherwise this process's verdicts, else the fixture. */
export async function listVerdicts(userId: string, limit: number): Promise<Verdict[]> {
  const rows = await tryDb((c) => c.verdicts.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray());
  if (rows) return rows;
  const mine = [...recentVerdicts.values()].filter((v) => v.userId === userId).reverse();
  return (mine.length ? mine : [fx.verdict]).slice(0, limit);
}

export async function getVerdict(id: string): Promise<Verdict | undefined> {
  return (
    recentVerdicts.get(id) ??
    (await tryDb((c) => c.verdicts.findOne({ _id: id }))) ??
    [fx.verdict, fx.timekeeperVerdict].find((f) => f._id === id)
  );
}
