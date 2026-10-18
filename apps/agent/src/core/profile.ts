// Owner: A. GET /profile — the Spending Profile (DESIGN.md §1, §8.3) from the user's transactions.
// Window: trailing 365 days, positive amounts only — the same window B's Worth-It uses, so totals match verdicts
// ("$640 at cafés"). Months are bucketed in Seattle time; the first and last month are partial.
import { collections } from "@alfred/shared/db";
import type { Category, Transaction } from "@alfred/shared";

const DAY = 86_400_000;
const TZ = "America/Los_Angeles";
const CADENCES = [
  { cadence: "weekly", days: 7, perMonth: 52 / 12 },
  { cadence: "biweekly", days: 14, perMonth: 26 / 12 },
  { cadence: "monthly", days: 30.44, perMonth: 1 },
] as const;
type Cadence = (typeof CADENCES)[number]["cadence"];

export type Profile = {
  totals12moCents: number;
  txCount: number;
  window: { from: Date; to: Date };
  byCategory: { category: Category; totalCents: number; txCount: number }[]; // largest first
  byMonth: { month: string; totalCents: number; byCategory: Partial<Record<Category, number>>; partial: boolean }[]; // "2026-10", oldest first, empty months included
  recurring: { merchant: string; merchantId: string; category: Category; monthlyCents: number; cadence: Cadence; lastChargedAt: Date }[]; // largest first
  topMerchants: { merchant: string; merchantId: string; category: Category; totalCents: number; txCount: number }[]; // top 10
};

const monthOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * A merchant is recurring when it has ≥3 charges whose gaps cluster on a weekly / biweekly / monthly rhythm (median gap
 * within ±25% of the cadence and ≥75% of gaps on it) and it was last charged within 1.5 cadences. Habits like cafés
 * (irregular gaps) don't qualify. monthlyCents = median charge × charges per month.
 */
function recurringOf(txs: Transaction[], now: Date) {
  if (txs.length < 3) return null;
  const times = txs.map((t) => t.ts.getTime()).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]!) / DAY);
  const gap = median(gaps);
  const c = CADENCES.find((x) => Math.abs(gap - x.days) <= x.days * 0.25);
  if (!c) return null;
  const onRhythm = gaps.filter((g) => Math.abs(g - c.days) <= c.days * 0.25).length / gaps.length;
  const last = times[times.length - 1]!;
  if (onRhythm < 0.75 || now.getTime() - last > c.days * 1.5 * DAY) return null;
  return { cadence: c.cadence, monthlyCents: Math.round(median(txs.map((t) => t.amountCents)) * c.perMonth), lastChargedAt: new Date(last) };
}

export function buildProfile(txs: Transaction[], names: Map<string, string>, now: Date, from: Date): Profile {
  const byCat = new Map<Category, { totalCents: number; txCount: number }>();
  const byMerchant = new Map<string, Transaction[]>();
  const months = new Map<string, Profile["byMonth"][number]>();
  // Every month the window touches, so charts get a continuous axis.
  for (let d = new Date(from); monthOf(d) <= monthOf(now); d = new Date(d.getTime() + 28 * DAY))
    months.set(monthOf(d), { month: monthOf(d), totalCents: 0, byCategory: {}, partial: false });
  months.set(monthOf(now), months.get(monthOf(now)) ?? { month: monthOf(now), totalCents: 0, byCategory: {}, partial: false });

  for (const t of txs) {
    const cat = t.meta.category;
    const cs = byCat.get(cat) ?? { totalCents: 0, txCount: 0 };
    cs.totalCents += t.amountCents;
    cs.txCount++;
    byCat.set(cat, cs);
    const list = byMerchant.get(t.meta.merchantId) ?? [];
    list.push(t);
    byMerchant.set(t.meta.merchantId, list);
    const m = months.get(monthOf(t.ts))!;
    m.totalCents += t.amountCents;
    m.byCategory[cat] = (m.byCategory[cat] ?? 0) + t.amountCents;
  }
  const byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (byMonth.length) byMonth[0]!.partial = byMonth[byMonth.length - 1]!.partial = true;

  const merchants = [...byMerchant.entries()].map(([merchantId, list]) => ({
    merchantId,
    merchant: names.get(merchantId) ?? merchantId,
    category: list[0]!.meta.category,
    totalCents: list.reduce((s, t) => s + t.amountCents, 0),
    list,
  }));

  return {
    totals12moCents: txs.reduce((s, t) => s + t.amountCents, 0),
    txCount: txs.length,
    window: { from, to: now },
    byCategory: [...byCat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.totalCents - a.totalCents),
    byMonth,
    recurring: merchants
      .flatMap(({ merchant, merchantId, category, list }) => {
        const r = recurringOf(list, now);
        return r ? [{ merchant, merchantId, category, ...r }] : [];
      })
      .sort((a, b) => b.monthlyCents - a.monthlyCents),
    topMerchants: merchants
      .map(({ list, ...m }) => ({ ...m, txCount: list.length }))
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 10),
  };
}

export async function getProfile(userId: string, now = new Date()): Promise<Profile> {
  const c = await collections();
  const from = new Date(now.getTime() - 365 * DAY);
  const txs = await c.transactions
    .find({ "meta.userId": userId, ts: { $gte: from, $lte: now }, amountCents: { $gt: 0 } }, { projection: { _id: 0 } })
    .toArray();
  const ids = [...new Set(txs.map((t) => t.meta.merchantId))];
  const names = new Map((await c.merchants.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()).map((m) => [m._id, m.name]));
  return buildProfile(txs, names, now, from);
}

/** No-db fallback: a small, plausible Maya-shaped profile built through the same code path. */
export function fixtureProfile(now = new Date()): Profile {
  const from = new Date(now.getTime() - 365 * DAY);
  const txs: Transaction[] = [];
  const add = (daysAgo: number, merchantId: string, category: Category, amountCents: number) =>
    txs.push({ ts: new Date(now.getTime() - daysAgo * DAY), meta: { userId: "u_maya", merchantId, category }, amountCents, cardId: "crd_sig" });
  for (let m = 0; m < 12; m++) {
    add(3 + m * 30.44, "mer_spotify", "subscriptions", 11_99);
    add(12 + m * 30.44, "mer_netflix", "subscriptions", 15_49);
    add(22 + m * 30.44, "mer_t_mobile", "phone", 85_00);
  }
  for (let w = 0; w < 52; w++) add(2 + w * 7, "mer_trader_joes", "groceries", 62_00 + (w % 5) * 7_00);
  for (let i = 0; i < 104; i++) add(2 + i * 3.5 + ((i * 7) % 5), "mer_starbucks", "coffee", 6_15); // irregular habit, ≈ $640/yr
  const names = new Map([["mer_spotify", "Spotify"], ["mer_netflix", "Netflix"], ["mer_t_mobile", "T-Mobile"], ["mer_trader_joes", "Trader Joe's"], ["mer_starbucks", "Starbucks"]]);
  return buildProfile(txs.filter((t) => t.ts >= from), names, now, from);
}
