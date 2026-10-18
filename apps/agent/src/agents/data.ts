// Owner: B. Read-side data access for the agents. Every agent reads seed data through these functions only.
import * as fx from "@alfred/shared/fixtures";
import { collections } from "@alfred/shared/db";
import type { Category, Offer, Product, User, Verdict } from "@alfred/shared";
import { env } from "../env";

const DAY = 86_400_000;

// Where seed data (products, offers, users, transactions, price history) comes from.
// Flip to "mongo" once A's seed is on main; fixtures remain the fallback for anything Mongo lacks.
const SEED_SOURCE = "fixtures" as "fixtures" | "mongo";

export const hasDb = () => Boolean(env.MONGODB_URI);

type Cols = Awaited<ReturnType<typeof collections>>;

/** Seed-data read: Mongo only when SEED_SOURCE is "mongo"; undefined → caller uses fixtures. */
const fromSeed = <T>(fn: (c: Cols) => Promise<T>) => (SEED_SOURCE === "mongo" ? tryDb(fn) : Promise.resolve(undefined));

/** Read of data the agents write themselves (verdicts, wishlist) — always Mongo when configured. */
async function tryDb<T>(fn: (c: Cols) => Promise<T>): Promise<T | undefined> {
  if (!hasDb()) return undefined;
  try {
    return await fn(await collections());
  } catch (e) {
    console.warn("[agents] db read failed, using fixtures:", (e as Error).message);
    return undefined;
  }
}

// ---------- products & offers ----------

export async function getProduct(productId: string): Promise<Product | undefined> {
  const p = await fromSeed((c) => c.products.findOne({ _id: productId }, { projection: { embedding: 0 } }));
  return p ?? (productId === fx.product._id ? fx.product : undefined);
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
  /** The price you can realistically wait for: median of the dipped weeks' lows, else p25 of weekly lows. */
  typicalLowCents: number;
  /** How many calendar weeks (Mon–Sun) dipped ≥5% below `refCents`. */
  dipsBelowRef: number;
};

export async function priceStats(productId: string, refCents: number, now = new Date()): Promise<PriceStats | undefined> {
  const since = new Date(now.getTime() - 90 * DAY);
  const pts = await fromSeed((c) =>
    c.priceHistory.find({ "meta.productId": productId, ts: { $gte: since, $lte: now } }).sort({ ts: 1 }).toArray(),
  );
  const series = pts?.length ? pts.map((p) => ({ ts: p.ts.getTime(), priceCents: p.priceCents })) : fallbackHistory(productId, now);
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
    typicalLowCents: dips.length ? median(dips) : lows[Math.floor(lows.length / 4)]!,
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

// ---------- past purchases (duplicate-ownership check) ----------

export type PastPurchase = { productId: string; title: string; amountCents: number; ts: Date };

/** Orders in the same category over the last 12 months. Orders are written at runtime by purchase(), so always Mongo;
 *  products resolve through getProduct so they follow SEED_SOURCE. */
export async function recentPurchases(userId: string, category: Category, now = new Date()): Promise<PastPurchase[]> {
  const orders = await tryDb((c) => c.orders.find({ userId, ts: { $gte: new Date(now.getTime() - 365 * DAY) } }).sort({ ts: -1 }).toArray());
  if (!orders?.length) return [];
  const ids = [...new Set(orders.map((o) => o.productId))];
  const byId = new Map((await Promise.all(ids.map(getProduct))).filter((p) => p?.category === category).map((p) => [p!._id, p!]));
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

export async function getVerdict(id: string): Promise<Verdict | undefined> {
  return (
    recentVerdicts.get(id) ??
    (await tryDb((c) => c.verdicts.findOne({ _id: id }))) ??
    [fx.verdict, fx.timekeeperVerdict].find((f) => f._id === id)
  );
}
