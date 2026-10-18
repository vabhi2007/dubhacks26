// Frozen contracts — DESIGN.md §8. Change only via PR reviewed by all owners.
import { z } from "zod";

// ---------- primitives ----------
export const Cents = z.number().int();
export const IsoDate = z.string(); // ISO-8601 on the wire; Date in Mongo

export const AgentName = z.enum([
  "orchestrator", "vision", "deal", "worth_it", "timekeeper",
  "watcher", "rewards", "smart_pay", "messenger",
]);
export const Surface = z.enum(["web", "extension", "imessage", "voice", "system"]);
export const Category = z.enum([
  "coffee", "groceries", "dining", "electronics", "kitchen", "home", "clothing",
  "subscriptions", "transport", "phone", "entertainment", "health", "travel", "other",
]);

// ---------- users & money ----------
export const User = z.object({
  _id: z.string(),
  name: z.string(),
  phone: z.string(),
  settings: z.object({
    confirmAboveCents: Cents,
    callAboveCents: Cents,
    monthlyBudgets: z.record(z.string(), Cents),
  }),
});

export const Transaction = z.object({
  ts: z.coerce.date(),
  meta: z.object({ userId: z.string(), merchantId: z.string(), category: Category }),
  amountCents: Cents,
  cardId: z.string(),
});

export const Merchant = z.object({
  _id: z.string(),
  name: z.string(),
  category: Category,
  mcc: z.string(),
  rewardsProgramId: z.string().optional(),
});

export const Card = z.object({
  _id: z.string(),
  userId: z.string(),
  network: z.literal("visa"),
  name: z.string(),
  last4: z.string().length(4),
  rewards: z.record(z.string(), z.number()), // category -> multiplier (e.g. 0.03 = 3%)
});

export const CardOffer = z.object({
  _id: z.string(),
  cardId: z.string(),
  merchantId: z.string().optional(),
  category: Category.optional(),
  kind: z.enum(["cashback", "points"]),
  value: z.number(),
  expiresAt: z.coerce.date(),
});

// ---------- products & prices ----------
export const Product = z.object({
  _id: z.string(),
  title: z.string(),
  brand: z.string(),
  model: z.string(),
  category: Category,
  imageUrl: z.string().optional(),
  embedding: z.array(z.number()).optional(),
  source: z.enum(["mock", "serpapi"]),
  canonicalKey: z.string(), // normalized brand+model, used for dedupe
});

export const Offer = z.object({
  _id: z.string(),
  productId: z.string(),
  seller: z.string(),
  priceCents: Cents,
  condition: z.enum(["new", "used", "refurb"]),
  region: z.string(), // "US", "UK", ...
  url: z.string().optional(),
  matched: z.enum(["exact", "variant", "different"]),
  fetchedAt: z.coerce.date(),
});

export const PricePoint = z.object({
  ts: z.coerce.date(),
  meta: z.object({ productId: z.string(), seller: z.string() }),
  priceCents: Cents,
});

export const WishlistItem = z.object({
  _id: z.string(),
  userId: z.string(),
  productId: z.string(),
  targetPriceCents: Cents,
  mandateId: z.string().optional(),
  status: z.enum(["watching", "triggered", "bought", "cancelled"]),
});

// ---------- mandates, approvals, orders ----------
export const Mandate = z.object({
  _id: z.string(),
  userId: z.string(),
  agent: AgentName,
  label: z.string(),
  capCents: Cents,
  spentCents: Cents,
  categories: z.array(Category),
  merchants: z.array(z.string()),
  expiresAt: z.coerce.date(),
  status: z.enum(["active", "revoked", "expired"]),
  card: z.object({ last4: z.string().length(4), token: z.string() }),
});

export const Approval = z.object({
  _id: z.string(),
  userId: z.string(),
  kind: z.enum(["purchase", "enroll"]),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  amountCents: Cents,
  productId: z.string().optional(),
  offerId: z.string().optional(),
  programId: z.string().optional(),
  mandateId: z.string().optional(),
  channel: z.enum(["imessage", "web", "voice"]),
  shortCode: z.string(), // e.g. "A7" so iMessage replies can reference it
  expiresAt: z.coerce.date(),
  resolvedAt: z.coerce.date().optional(),
});

export const Order = z.object({
  _id: z.string(),
  userId: z.string(),
  productId: z.string(),
  offerId: z.string(),
  mandateId: z.string(),
  cardId: z.string(),
  amountCents: Cents,
  rewardEarnedCents: Cents,
  ts: z.coerce.date(),
});

// ---------- rewards ----------
export const RewardsProgram = z.object({
  _id: z.string(),
  name: z.string(),
  merchantIds: z.array(z.string()),
  perks: z.array(z.string()),
  valueModel: z.object({ kind: z.enum(["pct_back", "per_visit", "flat"]), value: z.number() }),
  embedding: z.array(z.number()).optional(),
});

export const Enrollment = z.object({
  _id: z.string(),
  userId: z.string(),
  programId: z.string(),
  status: z.enum(["recommended", "enrolled", "dismissed"]),
  estAnnualValueCents: Cents,
});

// ---------- T-Mobile (Timekeeper) ----------
export const Device = z.object({
  _id: z.string(),
  userId: z.string(),
  model: z.string(),
  purchasedAt: z.coerce.date(),
  financingRemainingCents: Cents,
  batteryHealthPct: z.number(),
  storageUsedPct: z.number(),
});

export const TradeInCurve = z.object({
  _id: z.string(),
  model: z.string(),
  points: z.array(z.object({ month: z.number().int(), valueCents: Cents })),
});

export const Plan = z.object({
  _id: z.string(),
  name: z.string(),
  monthlyCents: Cents,
  lines: z.number().int(),
  perks: z.array(z.string()),
});

// ---------- verdicts & events (cross-surface) ----------
export const Verdict = z.object({
  _id: z.string(),
  userId: z.string(),
  productId: z.string(),
  kind: z.enum(["buy", "wait", "skip"]),
  mode: z.enum(["worth_it", "timekeeper"]),
  headline: z.string(),
  reasons: z.array(z.string()).min(1).max(4),
  math: z.object({
    priceCents: Cents,
    bestOfferId: z.string().optional(),
    paybackMonths: z.number().optional(),
    relatedSpend12moCents: Cents.optional(),
    budgetImpactPct: z.number().optional(),
    expectedDropCents: Cents.optional(),
    expectedWaitDays: z.number().int().nonnegative().optional(), // Worth-It "wait": days until the next likely sale, from dip cadence
  }),
  smartPay: z.object({ cardId: z.string(), offerId: z.string().optional(), rewardCents: Cents }).optional(),
  timekeeper: z.object({
    waitMonths: z.number(),
    costNowCents: Cents,
    costLaterCents: Cents,
    tradeInSeries: z.array(z.object({ month: z.number().int(), valueCents: Cents })),
  }).optional(),
  createdAt: z.coerce.date(),
});

export const AgentEventType = z.enum([
  "snap", "verdict", "watch_created", "price_drop", "approval_requested", "approval_resolved",
  "purchase", "mandate_declined", "reward_recommended", "reward_enrolled", "message",
]);

export const AgentEvent = z.object({
  _id: z.string(),
  userId: z.string(),
  ts: z.coerce.date(),
  agent: AgentName,
  surface: Surface,
  type: AgentEventType,
  summary: z.string(),
  refs: z.object({
    productId: z.string().optional(),
    verdictId: z.string().optional(),
    approvalId: z.string().optional(),
    mandateId: z.string().optional(),
    orderId: z.string().optional(),
  }),
});

export const ConversationMessage = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  ts: z.coerce.date(),
  surface: Surface,
  attachments: z.array(z.object({ kind: z.literal("image"), url: z.string() })).optional(),
});

export const Conversation = z.object({
  _id: z.string(),
  userId: z.string(),
  messages: z.array(ConversationMessage),
});

// ---------- API payloads (DESIGN.md §8.3) ----------
export const SnapRequest = z.object({
  image: z.string(), // base64
  source: z.enum(["extension", "imessage"]),
  pageUrl: z.string().optional(),
});
export const SnapResponse = z.object({
  product: Product,
  offers: z.array(Offer),
  similar: z.array(Product),
  verdict: Verdict,
});

export const ChatRequest = z.object({
  text: z.string(),
  surface: Surface,
  attachments: z.array(z.object({ kind: z.literal("image"), url: z.string() })).optional(),
});

export const ApprovalDecision = z.object({
  decision: z.enum(["approve", "deny"]),
  channel: z.enum(["imessage", "web", "voice"]),
});

export const Stats = z.object({
  savedCents: Cents,
  rewardsEarnedCents: Cents,
  purchases: z.number().int(),
  activeWatches: z.number().int(),
});

export const AdminPriceDrop = z.object({ productId: z.string(), newPriceCents: Cents });
export const AdminAdvanceTime = z.object({ days: z.number().int().positive() });

// ---------- inferred types ----------
export type User = z.infer<typeof User>;
export type Transaction = z.infer<typeof Transaction>;
export type Merchant = z.infer<typeof Merchant>;
export type Card = z.infer<typeof Card>;
export type CardOffer = z.infer<typeof CardOffer>;
export type Product = z.infer<typeof Product>;
export type Offer = z.infer<typeof Offer>;
export type PricePoint = z.infer<typeof PricePoint>;
export type WishlistItem = z.infer<typeof WishlistItem>;
export type Mandate = z.infer<typeof Mandate>;
export type Approval = z.infer<typeof Approval>;
export type Order = z.infer<typeof Order>;
export type RewardsProgram = z.infer<typeof RewardsProgram>;
export type Enrollment = z.infer<typeof Enrollment>;
export type Device = z.infer<typeof Device>;
export type TradeInCurve = z.infer<typeof TradeInCurve>;
export type Plan = z.infer<typeof Plan>;
export type Verdict = z.infer<typeof Verdict>;
export type AgentEvent = z.infer<typeof AgentEvent>;
export type AgentEventType = z.infer<typeof AgentEventType>;
export type Conversation = z.infer<typeof Conversation>;
export type ConversationMessage = z.infer<typeof ConversationMessage>;
export type SnapRequest = z.infer<typeof SnapRequest>;
export type SnapResponse = z.infer<typeof SnapResponse>;
export type ChatRequest = z.infer<typeof ChatRequest>;
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;
export type Stats = z.infer<typeof Stats>;
export type AgentName = z.infer<typeof AgentName>;
export type Surface = z.infer<typeof Surface>;
export type Category = z.infer<typeof Category>;
