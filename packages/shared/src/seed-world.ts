// Seed reference data: merchants, personas (user + cards + mandates + spending habits + phone), rewards programs,
// card-linked offers, T-Mobile trade-in curves and plans. Pure data — generation lives in seed.ts. Owner: A.
import type * as S from "./schemas";

export const MERCHANTS = {
  Starbucks: ["coffee", "5814"],
  "Cafe Allegro": ["coffee", "5814"],
  "Ugly Mug Cafe": ["coffee", "5814"],
  "Seattle Coffee Works": ["coffee", "5814"],
  "Trader Joe's": ["groceries", "5411"],
  QFC: ["groceries", "5411"],
  Safeway: ["groceries", "5411"],
  "PCC Community Markets": ["groceries", "5411"],
  Costco: ["groceries", "5300"],
  Chipotle: ["dining", "5814"],
  "Thai Tom": ["dining", "5812"],
  "Dick's Drive-In": ["dining", "5814"],
  "Pagliacci Pizza": ["dining", "5812"],
  Spotify: ["subscriptions", "5815"],
  Netflix: ["subscriptions", "4899"],
  iCloud: ["subscriptions", "5818"],
  Xbox: ["subscriptions", "5815"],
  ClassPass: ["health", "7997"],
  "T-Mobile": ["phone", "4814"],
  Uber: ["transport", "4121"],
  Lyft: ["transport", "4121"],
  Target: ["home", "5310"],
  IKEA: ["home", "5712"],
  Wayfair: ["home", "5712"],
  Amazon: ["other", "5999"],
  "Amazon UK": ["other", "5999"],
  Walmart: ["other", "5310"],
  Steam: ["entertainment", "5816"],
  "AMC Theatres": ["entertainment", "7832"],
  Uniqlo: ["clothing", "5651"],
  REI: ["clothing", "5941"],
  Nordstrom: ["clothing", "5651"],
  Zappos: ["clothing", "5661"],
  Walgreens: ["health", "5912"],
  "Sur La Table": ["kitchen", "5719"],
  "Williams Sonoma": ["kitchen", "5719"],
  // sellers in the mock catalog
  "Popover Kitchen": ["kitchen", "5719"],
  Breville: ["kitchen", "5722"],
  "Best Buy": ["electronics", "5732"],
  "B&H Photo": ["electronics", "5732"],
  Apple: ["electronics", "5732"],
  "Google Store": ["electronics", "5732"],
  "Back Market": ["electronics", "5732"],
  Swappa: ["electronics", "5732"],
  eBay: ["other", "5999"],
} as const satisfies Record<string, readonly [S.Category, string]>;
export type MerchantName = keyof typeof MERCHANTS;

// ---------- personas ----------
/**
 * A recurring spending pattern. Fires on a fixed day of month (`dom`), a fixed weekday (`dow`, 0 = Sun), or with daily
 * probability `p` (`pWeekend` on Sat/Sun); `dom`/`dow` habits fire with probability `p ?? 1` on matching days.
 */
export type Habit = {
  merchants: Partial<Record<MerchantName, number>>; // relative weights
  card: string;
  cents: readonly [number, number];
  weekendMaxCents?: number; // Fri/Sat upper bound (dinners out)
  hours: readonly [number, number]; // local time
  p?: number;
  pWeekend?: number;
  dow?: number;
  dom?: number;
  total12moCents?: number; // scale this habit's 12-month total to exactly this
};

export type Persona = {
  user: S.User;
  cards: Omit<S.Card, "userId" | "network">[];
  mandates: (Omit<S.Mandate, "userId" | "expiresAt"> & { expiresInDays: number })[];
  habits: Habit[];
  device: Omit<S.Device, "_id" | "userId" | "purchasedAt"> & { ageMonths: number };
  enrolled?: { programId: string; estAnnualValueCents: number }[];
};

const monthly = (merchant: MerchantName, dom: number, cents: number, card: string, hour = 6): Habit => ({ merchants: { [merchant]: 1 }, card, cents: [cents, cents], hours: [hour, hour], dom });

export const PERSONAS: Persona[] = [
  {
    // Hero (DESIGN.md §7, §11): UW student / young professional. Cafés exactly $640 over 12 months.
    user: {
      _id: "u_maya", name: "Maya Chen", phone: "+12065550142",
      settings: {
        confirmAboveCents: 100_00, callAboveCents: 500_00,
        monthlyBudgets: { coffee: 60_00, groceries: 320_00, dining: 160_00, kitchen: 75_00, home: 90_00, electronics: 100_00, clothing: 60_00, entertainment: 40_00, transport: 60_00, subscriptions: 35_00, other: 120_00 },
      },
    },
    cards: [
      { _id: "crd_sig", name: "Visa Signature Rewards", last4: "4821", rewards: { kitchen: 0.03, home: 0.03, electronics: 0.02, default: 0.01 } },
      { _id: "crd_dining", name: "Visa Dine & Sip", last4: "1177", rewards: { coffee: 0.04, dining: 0.04, entertainment: 0.02, default: 0.01 } },
      { _id: "crd_cash", name: "Visa Everyday Cash", last4: "3090", rewards: { groceries: 0.03, transport: 0.02, default: 0.015 } },
    ],
    mandates: [
      { _id: "mnd_kitchen", agent: "watcher", label: "Kitchen upgrades", capCents: 200_00, spentCents: 0, categories: ["kitchen"], merchants: [], expiresInDays: 44, status: "active", card: { last4: "4821", token: "tok_mock_kitchen" } },
      { _id: "mnd_coffee", agent: "smart_pay", label: "Coffee runs", capCents: 60_00, spentCents: 23_40, categories: ["coffee"], merchants: [], expiresInDays: 14, status: "active", card: { last4: "1177", token: "tok_mock_coffee" } },
    ],
    habits: [
      { merchants: { Starbucks: 6, "Cafe Allegro": 2, "Ugly Mug Cafe": 1, "Seattle Coffee Works": 1 }, card: "crd_dining", cents: [3_75, 7_45], hours: [7, 12], p: 0.38, pWeekend: 0.22, total12moCents: 640_00 },
      { merchants: { "Trader Joe's": 2, QFC: 1, Safeway: 1 }, card: "crd_cash", cents: [28_00, 96_00], hours: [10, 16], dow: 6 },
      { merchants: { QFC: 1, Safeway: 1 }, card: "crd_cash", cents: [8_00, 25_00], hours: [17, 20], dow: 3, p: 0.35 },
      { merchants: { Chipotle: 1, "Thai Tom": 1, "Dick's Drive-In": 1, "Pagliacci Pizza": 1 }, card: "crd_dining", cents: [11_00, 24_00], weekendMaxCents: 45_00, hours: [12, 20], p: 0.16, pWeekend: 0.3 },
      monthly("Spotify", 3, 11_99, "crd_sig"),
      monthly("Netflix", 12, 15_49, "crd_sig"),
      monthly("iCloud", 20, 2_99, "crd_sig"),
      monthly("T-Mobile", 22, 85_00, "crd_sig", 9),
      { merchants: { Uber: 1, Lyft: 1 }, card: "crd_cash", cents: [9_00, 32_00], hours: [8, 22], p: 0.08 },
      { merchants: { Target: 1 }, card: "crd_sig", cents: [14_00, 85_00], hours: [11, 20], p: 0.07 },
      { merchants: { Amazon: 1 }, card: "crd_sig", cents: [9_00, 65_00], hours: [9, 22], p: 0.1 },
      { merchants: { "AMC Theatres": 1 }, card: "crd_dining", cents: [14_00, 22_00], hours: [18, 21], p: 0.03 },
      { merchants: { Uniqlo: 1, REI: 1 }, card: "crd_sig", cents: [25_00, 120_00], hours: [12, 18], p: 0.015 },
      { merchants: { Walgreens: 1 }, card: "crd_cash", cents: [6_00, 35_00], hours: [10, 20], p: 0.02 },
      { merchants: { IKEA: 1 }, card: "crd_sig", cents: [60_00, 180_00], hours: [11, 16], p: 0.006 },
      { merchants: { "Best Buy": 1 }, card: "crd_sig", cents: [25_00, 150_00], hours: [11, 18], p: 0.005 },
      { merchants: { "Sur La Table": 1 }, card: "crd_sig", cents: [18_00, 45_00], hours: [11, 18], p: 0.006 },
    ],
    device: { model: "iPhone 15", ageMonths: 20, financingRemainingCents: 210_00, batteryHealthPct: 88, storageUsedPct: 71 },
    enrolled: [{ programId: "rwp_tmobile_tuesdays", estAnnualValueCents: 30_00 }],
  },
  {
    // Backup: grad student, gamer, eats out a lot, phone storage nearly full.
    user: {
      _id: "u_jordan", name: "Jordan Lee", phone: "+12065550177",
      settings: {
        confirmAboveCents: 150_00, callAboveCents: 600_00,
        monthlyBudgets: { electronics: 250_00, entertainment: 80_00, dining: 300_00, groceries: 300_00, coffee: 30_00, transport: 120_00, subscriptions: 60_00, other: 150_00 },
      },
    },
    cards: [
      { _id: "crd_jordan_tech", name: "Visa Signature Rewards", last4: "7730", rewards: { electronics: 0.04, entertainment: 0.03, subscriptions: 0.03, default: 0.01 } },
      { _id: "crd_jordan_cash", name: "Visa Everyday Cash", last4: "5512", rewards: { groceries: 0.03, transport: 0.02, default: 0.015 } },
      { _id: "crd_jordan_travel", name: "Visa Infinite Travel", last4: "2048", rewards: { travel: 0.05, dining: 0.03, default: 0.01 } },
    ],
    mandates: [
      { _id: "mnd_jordan_gaming", agent: "watcher", label: "Gaming gear", capCents: 300_00, spentCents: 0, categories: ["electronics", "entertainment"], merchants: [], expiresInDays: 30, status: "active", card: { last4: "7730", token: "tok_mock_jordan_gaming" } },
      { _id: "mnd_jordan_groceries", agent: "smart_pay", label: "Grocery autopilot", capCents: 150_00, spentCents: 61_20, categories: ["groceries"], merchants: [], expiresInDays: 21, status: "active", card: { last4: "5512", token: "tok_mock_jordan_groceries" } },
    ],
    habits: [
      { merchants: { Starbucks: 1 }, card: "crd_jordan_travel", cents: [4_45, 7_95], hours: [8, 13], p: 0.12, pWeekend: 0.05 },
      { merchants: { Safeway: 1 }, card: "crd_jordan_cash", cents: [35_00, 110_00], hours: [11, 18], dow: 0 },
      { merchants: { Costco: 1 }, card: "crd_jordan_cash", cents: [90_00, 220_00], hours: [11, 16], dom: 9, p: 0.8 },
      { merchants: { Chipotle: 3, "Dick's Drive-In": 2, "Pagliacci Pizza": 3, "Thai Tom": 1 }, card: "crd_jordan_travel", cents: [10_00, 28_00], weekendMaxCents: 55_00, hours: [12, 22], p: 0.3, pWeekend: 0.45 },
      monthly("Spotify", 5, 11_99, "crd_jordan_tech"),
      monthly("Netflix", 14, 15_49, "crd_jordan_tech"),
      monthly("Xbox", 18, 19_99, "crd_jordan_tech"),
      monthly("T-Mobile", 25, 75_00, "crd_jordan_tech", 9),
      { merchants: { Steam: 1 }, card: "crd_jordan_tech", cents: [9_99, 59_99], hours: [19, 23], p: 0.04 },
      { merchants: { Amazon: 1 }, card: "crd_jordan_tech", cents: [12_00, 90_00], hours: [9, 23], p: 0.18 },
      { merchants: { "Best Buy": 1 }, card: "crd_jordan_tech", cents: [30_00, 250_00], hours: [11, 19], p: 0.015 },
      { merchants: { Uber: 1 }, card: "crd_jordan_cash", cents: [11_00, 38_00], hours: [10, 23], p: 0.12 },
      { merchants: { "AMC Theatres": 1 }, card: "crd_jordan_tech", cents: [15_00, 24_00], hours: [18, 22], p: 0.04 },
      { merchants: { Target: 1 }, card: "crd_jordan_cash", cents: [12_00, 60_00], hours: [11, 20], p: 0.03 },
    ],
    device: { model: "Pixel 8", ageMonths: 26, financingRemainingCents: 0, batteryHealthPct: 79, storageUsedPct: 92 },
  },
  {
    // Backup: young professional, home cook and runner, local cafés over Starbucks.
    user: {
      _id: "u_priya", name: "Priya Shah", phone: "+12065550199",
      settings: {
        confirmAboveCents: 75_00, callAboveCents: 400_00,
        monthlyBudgets: { coffee: 45_00, groceries: 450_00, dining: 120_00, kitchen: 60_00, clothing: 80_00, health: 70_00, transport: 40_00, subscriptions: 70_00, home: 60_00, other: 80_00 },
      },
    },
    cards: [
      { _id: "crd_priya_dining", name: "Visa Dine & Sip", last4: "6604", rewards: { coffee: 0.04, dining: 0.04, groceries: 0.02, default: 0.01 } },
      { _id: "crd_priya_cash", name: "Visa Everyday Cash", last4: "9183", rewards: { groceries: 0.03, health: 0.03, transport: 0.02, default: 0.015 } },
      { _id: "crd_priya_sig", name: "Visa Signature Rewards", last4: "3375", rewards: { kitchen: 0.03, home: 0.03, clothing: 0.02, default: 0.01 } },
    ],
    mandates: [
      { _id: "mnd_priya_running", agent: "watcher", label: "Running gear", capCents: 250_00, spentCents: 0, categories: ["clothing", "health"], merchants: [], expiresInDays: 40, status: "active", card: { last4: "3375", token: "tok_mock_priya_running" } },
      { _id: "mnd_priya_kitchen", agent: "watcher", label: "Kitchen", capCents: 150_00, spentCents: 34_00, categories: ["kitchen"], merchants: [], expiresInDays: 30, status: "active", card: { last4: "3375", token: "tok_mock_priya_kitchen" } },
    ],
    habits: [
      { merchants: { "Cafe Allegro": 3, "Seattle Coffee Works": 2, "Ugly Mug Cafe": 1 }, card: "crd_priya_dining", cents: [3_75, 6_50], hours: [7, 11], p: 0.3, pWeekend: 0.35, total12moCents: 420_00 },
      { merchants: { "PCC Community Markets": 1 }, card: "crd_priya_cash", cents: [45_00, 120_00], hours: [10, 14], dow: 6 },
      { merchants: { "Trader Joe's": 1 }, card: "crd_priya_cash", cents: [20_00, 55_00], hours: [17, 20], dow: 3, p: 0.7 },
      { merchants: { "Thai Tom": 2, "Pagliacci Pizza": 1, Chipotle: 1 }, card: "crd_priya_dining", cents: [14_00, 30_00], weekendMaxCents: 70_00, hours: [12, 21], p: 0.12, pWeekend: 0.25 },
      { merchants: { "Sur La Table": 1, "Williams Sonoma": 1 }, card: "crd_priya_sig", cents: [18_00, 90_00], hours: [11, 18], p: 0.02 },
      { merchants: { REI: 1 }, card: "crd_priya_sig", cents: [25_00, 160_00], hours: [11, 18], p: 0.025 },
      monthly("ClassPass", 1, 49_00, "crd_priya_cash"),
      monthly("Spotify", 8, 11_99, "crd_priya_sig"),
      monthly("T-Mobile", 20, 65_00, "crd_priya_sig", 9),
      { merchants: { Walgreens: 1 }, card: "crd_priya_cash", cents: [6_00, 40_00], hours: [10, 20], p: 0.03 },
      { merchants: { Lyft: 1 }, card: "crd_priya_cash", cents: [10_00, 30_00], hours: [8, 22], p: 0.05 },
      { merchants: { Amazon: 1 }, card: "crd_priya_sig", cents: [10_00, 60_00], hours: [9, 22], p: 0.06 },
      { merchants: { Target: 1 }, card: "crd_priya_sig", cents: [15_00, 70_00], hours: [11, 20], p: 0.04 },
    ],
    device: { model: "iPhone 14 Pro", ageMonths: 30, financingRemainingCents: 0, batteryHealthPct: 84, storageUsedPct: 64 },
  },
];

// ---------- rewards programs (simulated enrollment) ----------
// valueModel: pct_back → value is the fraction of spend returned; per_visit → cents per visit; flat → cents per year.
export const REWARDS_PROGRAMS: (Omit<S.RewardsProgram, "merchantIds" | "embedding"> & { merchants: MerchantName[] })[] = [
  { _id: "rwp_starbucks", name: "Starbucks Rewards", merchants: ["Starbucks"], perks: ["2 Stars per $1 — a handcrafted drink every 100–200 Stars", "Free birthday drink", "Free refills on brewed coffee and tea in store", "Order ahead in the app"], valueModel: { kind: "pct_back", value: 0.134 } }, // ≈ $54/yr on Maya's Starbucks spend (DESIGN.md §11)
  { _id: "rwp_allegro_punch", name: "Cafe Allegro Punch Card", merchants: ["Cafe Allegro"], perks: ["Buy 10 drinks, get the 11th free"], valueModel: { kind: "per_visit", value: 45 } },
  { _id: "rwp_target_circle", name: "Target Circle", merchants: ["Target"], perks: ["Personalized deals in the Target app", "Birthday reward", "Easy returns without a receipt"], valueModel: { kind: "pct_back", value: 0.02 } },
  { _id: "rwp_qfc", name: "QFC Rewards", merchants: ["QFC"], perks: ["Digital coupons", "1 fuel point per $1 — save at the pump"], valueModel: { kind: "pct_back", value: 0.02 } },
  { _id: "rwp_safeway", name: "Safeway for U", merchants: ["Safeway"], perks: ["Personalized weekly deals", "Points toward grocery and gas rewards"], valueModel: { kind: "pct_back", value: 0.025 } },
  { _id: "rwp_chipotle", name: "Chipotle Rewards", merchants: ["Chipotle"], perks: ["10 points per $1", "Free chips and guac at 1,425 points", "Birthday reward"], valueModel: { kind: "pct_back", value: 0.08 } },
  { _id: "rwp_uber_one", name: "Uber One", merchants: ["Uber"], perks: ["6% Uber Cash on eligible rides", "$0 delivery fee on Uber Eats", "$9.99/month membership"], valueModel: { kind: "pct_back", value: 0.06 } },
  { _id: "rwp_lyft_pink", name: "Lyft Pink", merchants: ["Lyft"], perks: ["5% off rides", "Priority pickups", "$9.99/month membership"], valueModel: { kind: "pct_back", value: 0.05 } },
  { _id: "rwp_ikea_family", name: "IKEA Family", merchants: ["IKEA"], perks: ["Member-only prices", "Free coffee or tea in the IKEA restaurant"], valueModel: { kind: "pct_back", value: 0.03 } },
  { _id: "rwp_amc_stubs", name: "AMC Stubs Insider", merchants: ["AMC Theatres"], perks: ["100 points per $1 on tickets and concessions", "Free size upgrade on popcorn", "Discount Tuesdays"], valueModel: { kind: "per_visit", value: 1_50 } },
  { _id: "rwp_rei_coop", name: "REI Co-op Membership", merchants: ["REI"], perks: ["~10% annual member reward on eligible purchases", "Member-only sales", "$30 lifetime membership"], valueModel: { kind: "pct_back", value: 0.1 } },
  { _id: "rwp_walgreens", name: "myWalgreens", merchants: ["Walgreens"], perks: ["1% Walgreens Cash on purchases", "5% Walgreens Cash on Walgreens-brand products"], valueModel: { kind: "pct_back", value: 0.01 } },
  { _id: "rwp_tmobile_tuesdays", name: "T-Mobile Tuesdays", merchants: ["T-Mobile"], perks: ["Weekly freebies and partner discounts", "Free MLB.TV each season"], valueModel: { kind: "flat", value: 30_00 } },
  { _id: "rwp_pcc", name: "PCC Member", merchants: ["PCC Community Markets"], perks: ["Member deals every month", "10% off one shopping trip each month", "$60 lifetime membership"], valueModel: { kind: "pct_back", value: 0.03 } },
  { _id: "rwp_nordstrom", name: "The Nordy Club", merchants: ["Nordstrom"], perks: ["1 point per $1; $20 Nordstrom Note at 2,000 points", "Free basic alterations"], valueModel: { kind: "pct_back", value: 0.01 } },
];

// ---------- card-linked offers ----------
// value is the fraction of the purchase returned (points valued at 1¢). None touch the hero Bambino path (Popover Kitchen / kitchen).
export const CARD_OFFERS: (Omit<S.CardOffer, "merchantId" | "expiresAt"> & { merchant?: MerchantName; expiresInDays: number })[] = [
  { _id: "cof_sig_target", cardId: "crd_sig", merchant: "Target", kind: "cashback", value: 0.05, expiresInDays: 30 },
  { _id: "cof_sig_amazon", cardId: "crd_sig", merchant: "Amazon", kind: "points", value: 0.02, expiresInDays: 21 },
  { _id: "cof_sig_bestbuy", cardId: "crd_sig", merchant: "Best Buy", kind: "cashback", value: 0.04, expiresInDays: 45 },
  { _id: "cof_sig_ikea", cardId: "crd_sig", merchant: "IKEA", kind: "cashback", value: 0.06, expiresInDays: 60 },
  { _id: "cof_dining_sbux", cardId: "crd_dining", merchant: "Starbucks", kind: "cashback", value: 0.1, expiresInDays: 14 },
  { _id: "cof_dining_chipotle", cardId: "crd_dining", merchant: "Chipotle", kind: "cashback", value: 0.15, expiresInDays: 21 },
  { _id: "cof_dining_amc", cardId: "crd_dining", merchant: "AMC Theatres", kind: "points", value: 0.05, expiresInDays: 30 },
  { _id: "cof_cash_qfc", cardId: "crd_cash", merchant: "QFC", kind: "cashback", value: 0.05, expiresInDays: 30 },
  { _id: "cof_cash_lyft", cardId: "crd_cash", merchant: "Lyft", kind: "cashback", value: 0.1, expiresInDays: 10 },
  { _id: "cof_cash_walgreens", cardId: "crd_cash", merchant: "Walgreens", kind: "cashback", value: 0.05, expiresInDays: 30 },
  { _id: "cof_cash_dining", cardId: "crd_cash", category: "dining", kind: "points", value: 0.02, expiresInDays: 30 },
  { _id: "cof_jordan_tech_steam", cardId: "crd_jordan_tech", merchant: "Steam", kind: "cashback", value: 0.08, expiresInDays: 21 },
  { _id: "cof_jordan_tech_bestbuy", cardId: "crd_jordan_tech", merchant: "Best Buy", kind: "cashback", value: 0.05, expiresInDays: 30 },
  { _id: "cof_jordan_cash_costco", cardId: "crd_jordan_cash", merchant: "Costco", kind: "cashback", value: 0.03, expiresInDays: 45 },
  { _id: "cof_jordan_travel_pagliacci", cardId: "crd_jordan_travel", merchant: "Pagliacci Pizza", kind: "cashback", value: 0.1, expiresInDays: 14 },
  { _id: "cof_jordan_cash_uber", cardId: "crd_jordan_cash", merchant: "Uber", kind: "points", value: 0.05, expiresInDays: 30 },
  { _id: "cof_priya_sig_rei", cardId: "crd_priya_sig", merchant: "REI", kind: "cashback", value: 0.07, expiresInDays: 30 },
  { _id: "cof_priya_sig_williams", cardId: "crd_priya_sig", merchant: "Williams Sonoma", kind: "cashback", value: 0.05, expiresInDays: 45 },
  { _id: "cof_priya_cash_pcc", cardId: "crd_priya_cash", merchant: "PCC Community Markets", kind: "cashback", value: 0.04, expiresInDays: 30 },
  { _id: "cof_priya_dining_allegro", cardId: "crd_priya_dining", merchant: "Cafe Allegro", kind: "cashback", value: 0.1, expiresInDays: 14 },
];

// ---------- T-Mobile (Timekeeper) ----------
// Trade-in value forecast from today: month 0 = now. `cliff` = extra one-time drop when the successor launches.
export const TRADE_IN: { _id: string; model: string; nowCents: number; perMonthCents: number; cliff?: { month: number; cents: number } }[] = [
  { _id: "tic_iphone_15", model: "iPhone 15", nowCents: 310_00, perMonthCents: 10_00, cliff: { month: 5, cents: 50_00 } },
  { _id: "tic_iphone_14_pro", model: "iPhone 14 Pro", nowCents: 260_00, perMonthCents: 9_00, cliff: { month: 5, cents: 40_00 } },
  { _id: "tic_iphone_13", model: "iPhone 13", nowCents: 160_00, perMonthCents: 7_00 },
  { _id: "tic_iphone_16", model: "iPhone 16", nowCents: 450_00, perMonthCents: 12_00, cliff: { month: 11, cents: 60_00 } },
  { _id: "tic_pixel_8", model: "Pixel 8", nowCents: 180_00, perMonthCents: 8_00, cliff: { month: 10, cents: 30_00 } },
  { _id: "tic_galaxy_s24", model: "Galaxy S24", nowCents: 260_00, perMonthCents: 10_00, cliff: { month: 3, cents: 40_00 } },
];
export const TRADE_IN_MONTHS = 12;

export const PLANS: S.Plan[] = [
  { _id: "pln_essentials_saver_1", name: "Essentials Saver", monthlyCents: 50_00, lines: 1, perks: ["Unlimited 5G data (50GB priority)", "Unlimited talk & text"] },
  { _id: "pln_experience_more_1", name: "Experience More", monthlyCents: 85_00, lines: 1, perks: ["Unlimited premium 5G data", "Netflix Standard with ads", "Apple TV+", "60GB hotspot", "T-Mobile Tuesdays"] },
  { _id: "pln_experience_beyond_1", name: "Experience Beyond", monthlyCents: 100_00, lines: 1, perks: ["Unlimited premium 5G data", "Netflix, Apple TV+ and Hulu with ads", "Unlimited hotspot", "Upgrade every year", "T-Mobile Tuesdays"] },
  { _id: "pln_essentials_saver_2", name: "Essentials Saver", monthlyCents: 85_00, lines: 2, perks: ["Unlimited 5G data (50GB priority)", "Unlimited talk & text"] },
  { _id: "pln_experience_more_2", name: "Experience More", monthlyCents: 140_00, lines: 2, perks: ["Unlimited premium 5G data", "Netflix Standard with ads", "Apple TV+", "T-Mobile Tuesdays"] },
  { _id: "pln_experience_more_4", name: "Experience More", monthlyCents: 200_00, lines: 4, perks: ["Unlimited premium 5G data", "Netflix Standard with ads", "Apple TV+", "T-Mobile Tuesdays"] },
];
