// Deterministic demo data (DESIGN.md §7) for `pnpm seed` and POST /admin/reset. Server-side only. Owner: A.
// Values come from fixed Faker seeds (one stream per persona / catalog, so editing one doesn't reshuffle the others);
// dates are relative to today's UTC midnight, so reruns on the same day are identical.
// Wipes with deleteMany — never drops — so collections, time-series options and search indexes survive. Embeddings
// already in the db are carried over by _id, so a reset doesn't break Vector Search (re-embed with `pnpm indexes`).
// Ids match fixtures.ts (u_maya, prd_bambino, ofr_1, mnd_kitchen, crd_sig, …) so fixture-built UIs line up with real data.
import { Faker, en } from "@faker-js/faker";
import type { Db } from "mongodb";
import { COLLECTIONS, collections, getDb, merchantIdFor } from "./db";
import type * as S from "./schemas";
import { CATALOG } from "./seed-catalog";
import { PRODUCT_IMAGES } from "./seed-images";
import { CARD_OFFERS, MERCHANTS, PERSONAS, PLANS, REWARDS_PROGRAMS, TRADE_IN, TRADE_IN_MONTHS, type MerchantName, type Persona } from "./seed-world";

export const DEMO_USER_ID = "u_maya";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const PT_OFFSET = 7; // Seattle in October is UTC-7: local hour + 7 = UTC hour
const PRICE_HISTORY_DAYS = 90;

// ---------- schema ----------
const TIME_SERIES: Partial<Record<string, { timeField: string; metaField: string; granularity: "hours" }>> = {
  [COLLECTIONS.transactions]: { timeField: "ts", metaField: "meta", granularity: "hours" },
  [COLLECTIONS.priceHistory]: { timeField: "ts", metaField: "meta", granularity: "hours" },
};

/** Idempotently creates every collection (time series where needed) and the basic indexes. Returns newly created names. */
export async function ensureSchema(db: Db): Promise<string[]> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const created: string[] = [];
  for (const name of Object.values(COLLECTIONS)) {
    if (existing.has(name)) continue;
    const ts = TIME_SERIES[name];
    await db.createCollection(name, ts ? { timeseries: ts } : {});
    created.push(name);
  }
  await Promise.all([
    db.collection(COLLECTIONS.agentEvents).createIndex({ userId: 1, ts: -1 }),
    db.collection(COLLECTIONS.approvals).createIndex({ userId: 1, status: 1 }),
    db.collection(COLLECTIONS.approvals).createIndex({ shortCode: 1 }),
    db.collection(COLLECTIONS.offers).createIndex({ productId: 1, priceCents: 1 }),
    db.collection(COLLECTIONS.products).createIndex({ canonicalKey: 1 }, { unique: true }),
    db.collection(COLLECTIONS.wishlist).createIndex({ userId: 1, status: 1 }),
    db.collection(COLLECTIONS.mandates).createIndex({ userId: 1, status: 1 }),
    db.collection(COLLECTIONS.orders).createIndex({ userId: 1, ts: -1 }),
    // At most one pending approval per purchase, and short codes ("A7") unique among a user's pending approvals —
    // every teammate's agent watches the same db, so duplicate requests must collapse.
    db.collection(COLLECTIONS.approvals).createIndex({ userId: 1, kind: 1, productId: 1, offerId: 1, amountCents: 1 }, { name: "pending_dedupe", unique: true, partialFilterExpression: { status: "pending" } }),
    db.collection(COLLECTIONS.approvals).createIndex({ userId: 1, shortCode: 1 }, { name: "pending_shortcode", unique: true, partialFilterExpression: { status: "pending" } }),
    db.collection(COLLECTIONS.orders).createIndex({ userId: 1, idempotencyKey: 1 }, { name: "order_idempotency", unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }),
    db.collection(COLLECTIONS.approvals).createIndex({ userId: 1, idempotencyKey: 1 }, { name: "approval_idempotency", unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }),
  ]);
  return created;
}


// ---------- hero catalog (frozen: DESIGN.md §7) ----------
// price(daysAgo) → cents; daysAgo 0 is the current offer price.
type OfferSpec = { seller: MerchantName; condition: S.Offer["condition"]; matched?: S.Offer["matched"]; price: (daysAgo: number) => number; history?: boolean };
type ProductSpec = Pick<S.Product, "_id" | "title" | "brand" | "model" | "category" | "canonicalKey"> & { offers: OfferSpec[] };

// The Saturday+Sunday nearest each `centers` day (days ago), so dips land on real weekends.
function weekendsNear(today: number, centers: number[]) {
  const days = new Set<number>();
  for (const c of centers)
    for (let d = c - 3; d <= c + 3; d++) if (new Date(today - d * DAY).getUTCDay() === 6) days.add(d).add(d - 1);
  return days;
}

function heroCatalog(today: number): ProductSpec[] {
  const bambinoDips = weekendsNear(today, [77, 49, 21]); // "dipped to $149 three times in 90 days, usually on weekends"
  const phoneDip = weekendsNear(today, [49]);
  const flat = (cents: number) => () => cents;
  return [
    {
      _id: "prd_bambino", title: "Breville Bambino Espresso Machine", brand: "Breville", model: "BES450", category: "kitchen", canonicalKey: "breville-bes450",
      offers: [ // first three keep fixture ids ofr_1..ofr_3
        { seller: "Popover Kitchen", condition: "new", price: (d) => (bambinoDips.has(d) ? 149_00 : d > 29 ? 199_95 : d > 12 ? 189_95 : 179_00) },
        { seller: "Best Buy", condition: "new", price: (d) => (d >= 39 && d <= 45 ? 249_99 : 299_95) },
        { seller: "eBay", condition: "used", price: (d) => (129 + Math.round(Math.sin(d / 5) * 12)) * 100 },
        { seller: "Amazon", condition: "new", price: (d) => (bambinoDips.has(d) && d > 30 ? 199_00 : 249_00) },
        { seller: "Breville", condition: "refurb", price: flat(159_95) },
      ],
    },
    {
      _id: "prd_iphone17", title: "Apple iPhone 17 256GB", brand: "Apple", model: "iPhone 17", category: "electronics", canonicalKey: "apple-iphone-17-256gb",
      offers: [
        { seller: "Apple", condition: "new", price: flat(799_00) },
        { seller: "T-Mobile", condition: "new", price: flat(799_00) },
        { seller: "Best Buy", condition: "new", price: (d) => (phoneDip.has(d) ? 699_00 : 799_00) },
        { seller: "Back Market", condition: "refurb", price: (d) => (659 + Math.round((d * 60) / 89)) * 100 },
        { seller: "Swappa", condition: "used", price: (d) => (629 + Math.round((d * 50) / 89)) * 100 },
        { seller: "Amazon", condition: "new", matched: "variant", price: flat(999_00), history: false }, // 512GB listing
      ],
    },
    // similar items (offers only, no price history)
    { _id: "prd_bambino_plus", title: "Breville Bambino Plus Espresso Machine", brand: "Breville", model: "BES500", category: "kitchen", canonicalKey: "breville-bes500",
      offers: [{ seller: "Breville", condition: "new", price: flat(499_95), history: false }, { seller: "Amazon", condition: "new", price: flat(429_00), history: false }] },
    { _id: "prd_stilosa", title: "De'Longhi Stilosa Manual Espresso Machine", brand: "De'Longhi", model: "EC260BK", category: "kitchen", canonicalKey: "delonghi-ec260bk",
      offers: [{ seller: "Amazon", condition: "new", price: flat(99_95), history: false }, { seller: "Target", condition: "new", price: flat(119_99), history: false }] },
    { _id: "prd_gaggia_classic", title: "Gaggia Classic Pro Espresso Machine", brand: "Gaggia", model: "RI9380/46", category: "kitchen", canonicalKey: "gaggia-ri9380-46",
      offers: [{ seller: "Amazon", condition: "new", price: flat(449_00), history: false }, { seller: "Best Buy", condition: "new", price: flat(449_99), history: false }] },
    { _id: "prd_iphone16", title: "Apple iPhone 16 128GB", brand: "Apple", model: "iPhone 16", category: "electronics", canonicalKey: "apple-iphone-16-128gb",
      offers: [{ seller: "Apple", condition: "new", price: flat(599_00), history: false }, { seller: "Back Market", condition: "refurb", price: flat(489_00), history: false }] },
    { _id: "prd_pixel10", title: "Google Pixel 10 128GB", brand: "Google", model: "Pixel 10", category: "electronics", canonicalKey: "google-pixel-10-128gb",
      offers: [{ seller: "Google Store", condition: "new", price: flat(649_00), history: false }, { seller: "Amazon", condition: "new", price: flat(599_00), history: false }] },
  ];
}

// ---------- generated catalog ----------
const SELLERS: Partial<Record<S.Category, MerchantName[]>> = {
  electronics: ["Amazon", "Best Buy", "Target", "Walmart", "B&H Photo"],
  kitchen: ["Amazon", "Target", "Williams Sonoma", "Sur La Table", "Walmart"],
  home: ["Amazon", "Target", "Walmart", "Wayfair", "Costco"],
  health: ["Amazon", "Target", "Best Buy", "Walgreens", "Walmart"],
  clothing: ["Amazon", "REI", "Nordstrom", "Zappos"],
  travel: ["Amazon", "REI", "Nordstrom", "Target"],
  entertainment: ["Amazon", "Best Buy", "Target", "Walmart"],
};
const BRAND_STORES: Partial<Record<string, MerchantName>> = { Apple: "Apple", Google: "Google Store", IKEA: "IKEA", Uniqlo: "Uniqlo", Breville: "Breville" };

const slug = (s: string, sep = "-") =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, sep).replace(/^[-_]+|[-_]+$/g, "");
const to99 = (cents: number) => Math.max(99, Math.round(cents / 100) * 100 - 1); // $X.99

function generatedCatalog(f: Faker, today: number): ProductSpec[] {
  const int = (min: number, max: number) => f.number.int({ min, max });
  const between = (min: number, max: number) => f.number.float({ min, max });
  const chance = (p: number) => f.number.float() < p;
  return CATALOG.map(([category, brand, model, title, list]) => {
    const store = BRAND_STORES[brand];
    const pool = (SELLERS[category] ?? ["Amazon", "Target"]).filter((s) => s !== store);
    const sellers = [...(store ? [store] : []), ...f.helpers.arrayElements(pool, int(2, 3))];
    // First seller sits at list price; the rest discount up to ~22%. The cheapest new offer gets 90 days of history.
    const prices = sellers.map((_, i) => (i === 0 ? list : to99(list * (1 - between(0, 0.22)))));
    const cheapest = prices.indexOf(Math.min(...prices));
    const cur = prices[cheapest]!;
    const saleSince = int(0, 40); // days the current price has held (if below list)
    const dips = weekendsNear(today, chance(0.5) ? [int(saleSince + 7, 85), int(saleSince + 7, 85)] : [int(saleSince + 7, 85)]);
    const dip = to99(cur * 0.9);
    const offers: OfferSpec[] = sellers.map((seller, i) =>
      i === cheapest
        ? { seller, condition: "new", price: (d) => (dips.has(d) ? dip : d > saleSince ? list : cur) }
        : { seller, condition: "new", price: () => prices[i]!, history: false },
    );
    const resale = category === "electronics" || category === "kitchen" || category === "entertainment";
    if (chance(resale ? 0.35 : 0.12)) offers.push({ seller: "eBay", condition: "used", price: ((c) => () => c)(to99(list * between(0.55, 0.75))), history: false });
    if (category === "electronics" && chance(0.3)) offers.push({ seller: "Back Market", condition: "refurb", price: ((c) => () => c)(to99(list * between(0.72, 0.85))), history: false });
    if (chance(0.1)) offers.push({ seller: "Amazon", condition: "new", matched: "variant", price: ((c) => () => c)(to99(list * between(1.05, 1.25))), history: false });
    if (chance(0.06)) offers.push({ seller: "Amazon UK", condition: "new", price: ((c) => () => c)(to99(list * between(0.85, 1))), history: false });
    return { _id: `prd_${slug(brand, "_")}_${slug(model, "_")}`, title, brand, model, category, canonicalKey: `${slug(brand)}-${slug(model)}`, offers };
  });
}

// ---------- generators ----------
/** FNV-1a, so each stream (persona, catalog) gets its own stable Faker seed. */
function fakerFor(stream: string) {
  let h = 0x811c9dc5;
  for (const ch of stream) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const f = new Faker({ locale: [en] });
  f.seed(h);
  return f;
}

function transactions(f: Faker, today: number, p: Persona): S.Transaction[] {
  const chance = (q: number) => f.number.float() < q;
  const int = (min: number, max: number) => f.number.int({ min, max });
  const byHabit = p.habits.map((): S.Transaction[] => []);
  // Start 2 days back so local evening times never land in the future; stop at 364 so any trailing-12-month window sees all of it.
  for (let d = 2; d <= 364; d++) {
    const date = new Date(today - d * DAY);
    const dow = date.getUTCDay();
    const dom = date.getUTCDate();
    const weekend = dow === 0 || dow === 6;
    p.habits.forEach((h, i) => {
      const fires =
        h.dom !== undefined ? dom === h.dom && chance(h.p ?? 1)
        : h.dow !== undefined ? dow === h.dow && chance(h.p ?? 1)
        : chance(weekend ? (h.pWeekend ?? h.p ?? 0) : (h.p ?? 0));
      if (!fires) return;
      const merchant = f.helpers.weightedArrayElement(Object.entries(h.merchants).map(([value, weight]) => ({ value: value as MerchantName, weight: weight ?? 1 })));
      const max = h.weekendMaxCents && (dow === 5 || dow === 6) ? h.weekendMaxCents : h.cents[1];
      byHabit[i]!.push({
        ts: new Date(today - d * DAY + (int(h.hours[0], h.hours[1]) + PT_OFFSET) * HOUR + int(0, 59) * 60_000),
        meta: { userId: p.user._id, merchantId: merchantIdFor(merchant), category: MERCHANTS[merchant][0] },
        amountCents: int(h.cents[0], max),
        cardId: h.card,
      });
    });
  }
  // Habits with a fixed 12-month total (Maya's $640 at cafés): scale to exactly that, in 5¢ steps.
  p.habits.forEach((h, i) => {
    const txs = byHabit[i]!;
    if (!h.total12moCents || !txs.length) return;
    const raw = txs.reduce((s, t) => s + t.amountCents, 0);
    for (const t of txs) t.amountCents = Math.round((t.amountCents * h.total12moCents) / raw / 5) * 5;
    txs[txs.length - 1]!.amountCents += h.total12moCents - txs.reduce((s, t) => s + t.amountCents, 0);
  });
  return byHabit.flat().sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

function catalogDocs(today: number, specs: ProductSpec[]) {
  const fetchedAt = new Date(today);
  const products: S.Product[] = [];
  const offers: S.Offer[] = [];
  const priceHistory: S.PricePoint[] = [];
  const keys = new Set<string>();
  let n = 0;
  for (const { offers: os, ...p } of specs) {
    if (keys.has(p._id) || keys.has(p.canonicalKey)) throw new Error(`seed: duplicate product ${p._id} / ${p.canonicalKey}`);
    keys.add(p._id).add(p.canonicalKey);
    // Real images only where hand-picked (seed-images.ts); the rest have none and the UI shows a monogram.
    products.push({ ...p, source: "mock", ...(PRODUCT_IMAGES[p._id] && { imageUrl: PRODUCT_IMAGES[p._id] }) });
    for (const o of os) {
      offers.push({
        _id: `ofr_${++n}`, productId: p._id, seller: o.seller, priceCents: o.price(0), condition: o.condition, region: o.seller === "Amazon UK" ? "UK" : "US",
        url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${p.title} ${o.seller}`)}`, matched: o.matched ?? "exact", fetchedAt,
      });
      if (o.history === false) continue;
      for (let d = PRICE_HISTORY_DAYS - 1; d >= 0; d--)
        priceHistory.push({ ts: new Date(today - d * DAY), meta: { productId: p._id, seller: o.seller }, priceCents: o.price(d) });
    }
  }
  for (const id of Object.keys(PRODUCT_IMAGES)) if (!keys.has(id)) throw new Error(`seed: PRODUCT_IMAGES has unknown product ${id}`);
  return { products, offers, priceHistory };
}

function personaDocs(today: number, p: Persona) {
  const userId = p.user._id;
  const cardIds = new Set(p.cards.map((c) => c._id));
  for (const h of p.habits) if (!cardIds.has(h.card)) throw new Error(`seed: ${userId} habit uses unknown card ${h.card}`);
  const cards: S.Card[] = p.cards.map((c) => ({ ...c, userId, network: "visa" }));
  const mandates: S.Mandate[] = p.mandates.map(({ expiresInDays, ...m }) => ({ ...m, userId, expiresAt: new Date(today + expiresInDays * DAY) }));
  const device: S.Device = {
    _id: `dev_${userId.replace(/^u_/, "")}`, userId, model: p.device.model, purchasedAt: new Date(today - Math.round(p.device.ageMonths * 30.44) * DAY),
    financingRemainingCents: p.device.financingRemainingCents, batteryHealthPct: p.device.batteryHealthPct, storageUsedPct: p.device.storageUsedPct,
  };
  const enrollments: S.Enrollment[] = (p.enrolled ?? []).map((e) => ({ _id: `enr_${userId.replace(/^u_/, "")}_${e.programId.replace(/^rwp_/, "")}`, userId, programId: e.programId, status: "enrolled", estAnnualValueCents: e.estAnnualValueCents }));
  return { cards, mandates, device, enrollments, transactions: transactions(fakerFor(userId), today, p) };
}

// ---------- entry point ----------
/** Wipes every collection and inserts the demo world. Returns inserted counts per collection. */
export async function seedDemo(opts: { now?: Date } = {}): Promise<Record<string, number>> {
  const db = await getDb();
  await ensureSchema(db);
  const c = await collections();

  const now = opts.now ?? new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const programOf = new Map<string, string>(REWARDS_PROGRAMS.flatMap((r) => r.merchants.map((m) => [merchantIdFor(m), r._id] as const)));
  const merchants: S.Merchant[] = Object.entries(MERCHANTS).map(([name, [category, mcc]]) => {
    const _id = merchantIdFor(name);
    return { _id, name, category, mcc, rewardsProgramId: programOf.get(_id) };
  });
  const people = PERSONAS.map((p) => personaDocs(today, p));
  const { products, offers, priceHistory } = catalogDocs(today, [...heroCatalog(today), ...generatedCatalog(fakerFor("catalog"), today)]);
  const rewardsPrograms: S.RewardsProgram[] = REWARDS_PROGRAMS.map(({ merchants: ms, ...r }) => ({ ...r, merchantIds: ms.map(merchantIdFor) }));
  const cardOffers: S.CardOffer[] = CARD_OFFERS.map(({ merchant, expiresInDays, ...o }) => ({ ...o, merchantId: merchant && merchantIdFor(merchant), expiresAt: new Date(today + expiresInDays * DAY) }));
  const tradeinCurves: S.TradeInCurve[] = TRADE_IN.map(({ _id, model, nowCents, perMonthCents, cliff }) => ({
    _id, model,
    points: Array.from({ length: TRADE_IN_MONTHS + 1 }, (_, month) => ({ month, valueCents: Math.max(0, nowCents - perMonthCents * month - (cliff && month >= cliff.month ? cliff.cents : 0)) })),
  }));

  // Carry embeddings over by _id (deterministic docs → same text), then wipe.
  const [embP, embR] = await Promise.all([
    c.products.find({ embedding: { $exists: true } }, { projection: { embedding: 1 } }).toArray(),
    c.rewardsPrograms.find({ embedding: { $exists: true } }, { projection: { embedding: 1 } }).toArray(),
  ]);
  const keep = new Map<string, number[]>([...embP, ...embR].map((d) => [d._id, d.embedding!]));
  const withEmbedding = <T extends { _id: string; embedding?: number[] }>(d: T): T => (keep.has(d._id) ? { ...d, embedding: keep.get(d._id) } : d);

  await Promise.all(Object.values(COLLECTIONS).map((name) => db.collection(name).deleteMany({})));
  const W = { ignoreUndefined: true }; // omit undefined optional fields (e.g. merchants without a rewards program) instead of storing null
  const TS = { ...W, ordered: false }; // time series: unordered for speed
  await Promise.all([
    c.users.insertMany(PERSONAS.map((p) => p.user), W),
    c.merchants.insertMany(merchants, W),
    c.cards.insertMany(people.flatMap((p) => p.cards), W),
    c.mandates.insertMany(people.flatMap((p) => p.mandates), W),
    c.devices.insertMany(people.map((p) => p.device), W),
    c.enrollments.insertMany(people.flatMap((p) => p.enrollments), W),
    c.transactions.insertMany(people.flatMap((p) => p.transactions), TS),
    c.products.insertMany(products.map(withEmbedding), W),
    c.offers.insertMany(offers, W),
    c.priceHistory.insertMany(priceHistory, TS),
    c.rewardsPrograms.insertMany(rewardsPrograms.map(withEmbedding), W),
    c.cardOffers.insertMany(cardOffers, W),
    c.tradeinCurves.insertMany(tradeinCurves, W),
    c.plans.insertMany(PLANS, W),
  ]);

  return {
    users: PERSONAS.length, merchants: merchants.length, cards: people.reduce((s, p) => s + p.cards.length, 0),
    mandates: people.reduce((s, p) => s + p.mandates.length, 0), transactions: people.reduce((s, p) => s + p.transactions.length, 0),
    products: products.length, offers: offers.length, price_history: priceHistory.length, rewards_programs: rewardsPrograms.length,
    card_offers: cardOffers.length, devices: people.length, tradein_curves: tradeinCurves.length, plans: PLANS.length,
    enrollments: people.reduce((s, p) => s + p.enrollments.length, 0), embeddings_kept: keep.size,
  };
}
