// Mongo client + typed collection accessors. Server-side only (agent service, scripts).
import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type * as S from "./schemas";

export const COLLECTIONS = {
  users: "users",
  transactions: "transactions",       // time series
  merchants: "merchants",
  products: "products",
  offers: "offers",
  priceHistory: "price_history",      // time series
  wishlist: "wishlist",
  mandates: "mandates",
  cards: "cards",
  cardOffers: "card_offers",
  rewardsPrograms: "rewards_programs",
  enrollments: "enrollments",
  devices: "devices",
  tradeinCurves: "tradein_curves",
  plans: "plans",
  verdicts: "verdicts",
  approvals: "approvals",
  orders: "orders",
  agentEvents: "agent_events",
  conversations: "conversations",
} as const;

let client: MongoClient | undefined;
let db: Db | undefined;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  client = new MongoClient(uri, { appName: "alfred" });
  await client.connect();
  db = client.db(process.env.MONGODB_DB ?? "alfred");
  return db;
}

export async function closeDb() {
  await client?.close();
  client = undefined;
  db = undefined;
}

// Ids are prefixed strings (e.g. "prd_x8k2"), not ObjectIds, so they round-trip through JSON/SSE/iMessage cleanly.
export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// Stable merchant id from a display name ("Trader Joe's" → "mer_trader_joes"), so offers' `seller` maps to a merchant without a lookup.
export function merchantIdFor(name: string) {
  return `mer_${name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

export async function collections() {
  const d = await getDb();
  const c = <T extends Document>(name: string): Collection<T> => d.collection<T>(name);
  return {
    users: c<S.User>(COLLECTIONS.users),
    transactions: c<S.Transaction>(COLLECTIONS.transactions),
    merchants: c<S.Merchant>(COLLECTIONS.merchants),
    products: c<S.Product>(COLLECTIONS.products),
    offers: c<S.Offer>(COLLECTIONS.offers),
    priceHistory: c<S.PricePoint>(COLLECTIONS.priceHistory),
    wishlist: c<S.WishlistItem>(COLLECTIONS.wishlist),
    mandates: c<S.Mandate>(COLLECTIONS.mandates),
    cards: c<S.Card>(COLLECTIONS.cards),
    cardOffers: c<S.CardOffer>(COLLECTIONS.cardOffers),
    rewardsPrograms: c<S.RewardsProgram>(COLLECTIONS.rewardsPrograms),
    enrollments: c<S.Enrollment>(COLLECTIONS.enrollments),
    devices: c<S.Device>(COLLECTIONS.devices),
    tradeinCurves: c<S.TradeInCurve>(COLLECTIONS.tradeinCurves),
    plans: c<S.Plan>(COLLECTIONS.plans),
    verdicts: c<S.Verdict>(COLLECTIONS.verdicts),
    approvals: c<S.Approval>(COLLECTIONS.approvals),
    orders: c<S.Order>(COLLECTIONS.orders),
    agentEvents: c<S.AgentEvent>(COLLECTIONS.agentEvents),
    conversations: c<S.Conversation>(COLLECTIONS.conversations),
  };
}
export type Collections = Awaited<ReturnType<typeof collections>>;
