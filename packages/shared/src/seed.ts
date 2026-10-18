// Deterministic demo data (DESIGN.md §7) for `pnpm seed` and POST /admin/reset. Server-side only. Owner: A.
// Values come from a fixed Faker seed; dates are relative to today's UTC midnight, so reruns on the same day are identical.
// Wipes with deleteMany — never drops — so collections, time-series options and search indexes survive.
// Ids match fixtures.ts (u_maya, prd_bambino, ofr_1, mnd_kitchen, crd_sig, …) so fixture-built UIs line up with real data.
import { Faker, en } from "@faker-js/faker";
import type { Db } from "mongodb";
import { COLLECTIONS, collections, getDb, merchantIdFor } from "./db";
import type * as S from "./schemas";

export const DEMO_USER_ID = "u_maya";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const PT_OFFSET = 7; // Seattle in October is UTC-7: local hour + 7 = UTC hour
const CAFE_TOTAL_12MO = 640_00;
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

// ---------- static reference data ----------
const MERCHANTS = {
  Starbucks: ["coffee", "5814"],
  "Cafe Allegro": ["coffee", "5814"],
  "Ugly Mug Cafe": ["coffee", "5814"],
  "Seattle Coffee Works": ["coffee", "5814"],
  "Trader Joe's": ["groceries", "5411"],
  QFC: ["groceries", "5411"],
  Safeway: ["groceries", "5411"],
  Chipotle: ["dining", "5814"],
  "Thai Tom": ["dining", "5812"],
  "Dick's Drive-In": ["dining", "5814"],
  "Pagliacci Pizza": ["dining", "5812"],
  Spotify: ["subscriptions", "5815"],
  Netflix: ["subscriptions", "4899"],
  iCloud: ["subscriptions", "5818"],
  "T-Mobile": ["phone", "4814"],
  Uber: ["transport", "4121"],
  Lyft: ["transport", "4121"],
  Target: ["home", "5310"],
  IKEA: ["home", "5712"],
  Amazon: ["other", "5999"],
  "AMC Theatres": ["entertainment", "7832"],
  Uniqlo: ["clothing", "5651"],
  REI: ["clothing", "5941"],
  Walgreens: ["health", "5912"],
  "Sur La Table": ["kitchen", "5719"],
  // sellers in the mock catalog
  "Popover Kitchen": ["kitchen", "5719"],
  Breville: ["kitchen", "5722"],
  "Best Buy": ["electronics", "5732"],
  Apple: ["electronics", "5732"],
  "Google Store": ["electronics", "5732"],
  "Back Market": ["electronics", "5732"],
  Swappa: ["electronics", "5732"],
  eBay: ["other", "5999"],
} as const satisfies Record<string, readonly [S.Category, string]>;
type MerchantName = keyof typeof MERCHANTS;

// rewards: category → multiplier; `default` applies to every other category.
const CARDS: S.Card[] = [
  { _id: "crd_sig", userId: DEMO_USER_ID, network: "visa", name: "Visa Signature Rewards", last4: "4821", rewards: { kitchen: 0.03, home: 0.03, electronics: 0.02, default: 0.01 } },
  { _id: "crd_dining", userId: DEMO_USER_ID, network: "visa", name: "Visa Dine & Sip", last4: "1177", rewards: { coffee: 0.04, dining: 0.04, entertainment: 0.02, default: 0.01 } },
  { _id: "crd_cash", userId: DEMO_USER_ID, network: "visa", name: "Visa Everyday Cash", last4: "3090", rewards: { groceries: 0.03, transport: 0.02, default: 0.015 } },
];

const USER: S.User = {
  _id: DEMO_USER_ID,
  name: "Maya Chen",
  phone: "+12065550142",
  settings: {
    confirmAboveCents: 100_00,
    callAboveCents: 500_00,
    monthlyBudgets: {
      coffee: 60_00, groceries: 320_00, dining: 160_00, kitchen: 75_00, home: 90_00, electronics: 100_00,
      clothing: 60_00, entertainment: 40_00, transport: 60_00, subscriptions: 35_00, other: 120_00,
    },
  },
};

// ---------- catalog ----------
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

function catalog(today: number): ProductSpec[] {
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

// ---------- generators ----------
function transactions(f: Faker, today: number): S.Transaction[] {
  const chance = (p: number) => f.number.float() < p;
  const int = (min: number, max: number) => f.number.int({ min, max });
  const pick = <T>(xs: readonly T[]) => f.helpers.arrayElement(xs);
  const tx = (daysAgo: number, localHour: number, merchant: MerchantName, amountCents: number, cardId: string): S.Transaction => ({
    ts: new Date(today - daysAgo * DAY + (localHour + PT_OFFSET) * HOUR + int(0, 59) * 60_000),
    meta: { userId: DEMO_USER_ID, merchantId: merchantIdFor(merchant), category: MERCHANTS[merchant][0] },
    amountCents,
    cardId,
  });

  const cafe: S.Transaction[] = [];
  const rest: S.Transaction[] = [];
  // Start 2 days back so local evening times never land in the future.
  for (let d = 2; d <= 365; d++) {
    const date = new Date(today - d * DAY);
    const dow = date.getUTCDay();
    const dom = date.getUTCDate();
    const weekend = dow === 0 || dow === 6;
    const add = (hour: number, m: MerchantName, cents: number, card: string) => rest.push(tx(d, hour, m, cents, card));

    // Cafés: ~2.3 visits/week, ~60% Starbucks (rewards demo). Kept inside 364 days so any trailing-12-month window sees all of it.
    if (d <= 364 && chance(weekend ? 0.22 : 0.38)) {
      const sbux = chance(0.6);
      cafe.push(tx(d, weekend ? int(9, 13) : int(7, 10), sbux ? "Starbucks" : pick(["Cafe Allegro", "Ugly Mug Cafe", "Seattle Coffee Works"] as const), sbux ? int(495, 745) : int(375, 650), "crd_dining"));
    }
    if (dow === 6) add(int(10, 16), pick(["Trader Joe's", "Trader Joe's", "QFC", "Safeway"] as const), int(28_00, 96_00), "crd_cash");
    if (dow === 3 && chance(0.35)) add(int(17, 20), pick(["QFC", "Safeway"] as const), int(8_00, 25_00), "crd_cash");
    if (chance(weekend ? 0.3 : 0.16)) add(int(12, 20), pick(["Chipotle", "Thai Tom", "Dick's Drive-In", "Pagliacci Pizza"] as const), int(11_00, dow === 5 || dow === 6 ? 45_00 : 24_00), "crd_dining");
    if (dom === 3) add(6, "Spotify", 11_99, "crd_sig");
    if (dom === 12) add(6, "Netflix", 15_49, "crd_sig");
    if (dom === 20) add(6, "iCloud", 2_99, "crd_sig");
    if (dom === 22) add(9, "T-Mobile", 85_00, "crd_sig");
    if (chance(0.08)) add(int(8, 22), pick(["Uber", "Lyft"] as const), int(9_00, 32_00), "crd_cash");
    if (chance(0.07)) add(int(11, 20), "Target", int(14_00, 85_00), "crd_sig");
    if (chance(0.1)) add(int(9, 22), "Amazon", int(9_00, 65_00), "crd_sig");
    if (chance(0.03)) add(int(18, 21), "AMC Theatres", int(14_00, 22_00), "crd_dining");
    if (chance(0.015)) add(int(12, 18), pick(["Uniqlo", "REI"] as const), int(25_00, 120_00), "crd_sig");
    if (chance(0.02)) add(int(10, 20), "Walgreens", int(6_00, 35_00), "crd_cash");
    if (chance(0.006)) add(int(11, 16), "IKEA", int(60_00, 180_00), "crd_sig");
    if (chance(0.005)) add(int(11, 18), "Best Buy", int(25_00, 150_00), "crd_sig");
    if (chance(0.006)) add(int(11, 18), "Sur La Table", int(18_00, 45_00), "crd_sig");
  }

  // Scale café amounts (to 5¢) so the 12-month total is exactly CAFE_TOTAL_12MO.
  const raw = cafe.reduce((s, t) => s + t.amountCents, 0);
  for (const t of cafe) t.amountCents = Math.round((t.amountCents * CAFE_TOTAL_12MO) / raw / 5) * 5;
  cafe[cafe.length - 1]!.amountCents += CAFE_TOTAL_12MO - cafe.reduce((s, t) => s + t.amountCents, 0);

  return [...cafe, ...rest].sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

function catalogDocs(today: number) {
  const fetchedAt = new Date(today);
  const products: S.Product[] = [];
  const offers: S.Offer[] = [];
  const priceHistory: S.PricePoint[] = [];
  let n = 0;
  for (const { offers: specs, ...p } of catalog(today)) {
    products.push({ ...p, source: "mock", imageUrl: `https://placehold.co/400x400/141416/E2A829?text=${encodeURIComponent(p.model)}` });
    for (const o of specs) {
      offers.push({
        _id: `ofr_${++n}`, productId: p._id, seller: o.seller, priceCents: o.price(0), condition: o.condition, region: "US",
        url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`${p.title} ${o.seller}`)}`, matched: o.matched ?? "exact", fetchedAt,
      });
      if (o.history === false) continue;
      for (let d = PRICE_HISTORY_DAYS - 1; d >= 0; d--)
        priceHistory.push({ ts: new Date(today - d * DAY), meta: { productId: p._id, seller: o.seller }, priceCents: o.price(d) });
    }
  }
  return { products, offers, priceHistory };
}

// ---------- entry point ----------
/** Wipes every collection and inserts the demo world. Returns inserted counts per collection. */
export async function seedDemo(opts: { now?: Date } = {}): Promise<Record<string, number>> {
  const db = await getDb();
  await ensureSchema(db);
  const c = await collections();

  const now = opts.now ?? new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const f = new Faker({ locale: [en] });
  f.seed(2026);

  const merchants: S.Merchant[] = Object.entries(MERCHANTS).map(([name, [category, mcc]]) => ({ _id: merchantIdFor(name), name, category, mcc }));
  const txns = transactions(f, today);
  const { products, offers, priceHistory } = catalogDocs(today);

  const mandates: S.Mandate[] = [
    { _id: "mnd_kitchen", userId: DEMO_USER_ID, agent: "watcher", label: "Kitchen upgrades", capCents: 200_00, spentCents: 0, categories: ["kitchen"], merchants: [], expiresAt: new Date(today + 44 * DAY), status: "active", card: { last4: "4821", token: "tok_mock_kitchen" } },
    { _id: "mnd_coffee", userId: DEMO_USER_ID, agent: "smart_pay", label: "Coffee runs", capCents: 60_00, spentCents: 23_40, categories: ["coffee"], merchants: [], expiresAt: new Date(today + 14 * DAY), status: "active", card: { last4: "1177", token: "tok_mock_coffee" } },
  ];

  await Promise.all(Object.values(COLLECTIONS).map((name) => db.collection(name).deleteMany({})));
  await Promise.all([
    c.users.insertOne(USER),
    c.merchants.insertMany(merchants),
    c.cards.insertMany(CARDS),
    c.mandates.insertMany(mandates),
    c.transactions.insertMany(txns, { ordered: false }),
    c.products.insertMany(products),
    c.offers.insertMany(offers),
    c.priceHistory.insertMany(priceHistory, { ordered: false }),
  ]);

  return {
    users: 1, merchants: merchants.length, cards: CARDS.length, mandates: mandates.length, transactions: txns.length,
    products: products.length, offers: offers.length, price_history: priceHistory.length,
  };
}
