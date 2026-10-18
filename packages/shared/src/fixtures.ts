// Static fixtures matching the frozen contracts. UI and extension build against these until routes are live.
import type { AgentEvent, Approval, Mandate, Offer, Product, SnapResponse, Stats, Verdict } from "./schemas";

const now = new Date("2026-10-18T17:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

export const product: Product = {
  _id: "prd_bambino_plus",
  title: "Breville Bambino Plus Espresso Machine",
  brand: "Breville",
  model: "BES500",
  category: "kitchen",
  imageUrl: "https://assets.breville.com/cdn-cgi/image/width=600,format=auto/BES500/BES500BSS1BUS1/pdp_1300px.png",
  source: "mock",
  canonicalKey: "breville-bes500",
};

export const offers: Offer[] = [
  { _id: "ofr_1", productId: product._id, seller: "Popover Kitchen", priceCents: 499_95, condition: "new", region: "US", matched: "exact", fetchedAt: now, url: "https://example.com/1" },
  { _id: "ofr_2", productId: product._id, seller: "Best Buy", priceCents: 549_95, condition: "new", region: "US", matched: "exact", fetchedAt: now, url: "https://example.com/2" },
  { _id: "ofr_3", productId: product._id, seller: "eBay", priceCents: 349_95, condition: "used", region: "US", matched: "exact", fetchedAt: now, url: "https://example.com/3" },
];

export const verdict: Verdict = {
  _id: "vrd_1",
  userId: "u_maya",
  productId: product._id,
  kind: "wait",
  mode: "worth_it",
  headline: "Pays for itself in 9.4 months — but it usually drops on weekends.",
  reasons: [
    "You spent $640 at cafés in the last 12 months.",
    "Best new US price is $499.95 at Popover Kitchen ($50 under Best Buy).",
    "This model dipped to $449.95 three times in the last 90 days.",
  ],
  math: { priceCents: 499_95, bestOfferId: "ofr_1", paybackMonths: 9.4, relatedSpend12moCents: 640_00, budgetImpactPct: 0.36, expectedDropCents: 50_00 },
  smartPay: { cardId: "crd_sig", rewardCents: 13_50 },
  createdAt: minsAgo(3),
};

export const timekeeperVerdict: Verdict = {
  _id: "vrd_2",
  userId: "u_maya",
  productId: "prd_iphone17",
  kind: "wait",
  mode: "timekeeper",
  headline: "Wait 4 months — your trade-in only drops $40 and you still owe $210.",
  reasons: [
    "Battery health is 88% — no urgency.",
    "Financing on your iPhone 15 ends in February.",
    "Trade-in value falls ~$10/month until then.",
  ],
  math: { priceCents: 799_00 },
  timekeeper: {
    waitMonths: 4,
    costNowCents: 799_00 - 310_00 + 210_00,
    costLaterCents: 799_00 - 270_00,
    tradeInSeries: [0, 1, 2, 3, 4, 5, 6].map((m) => ({ month: m, valueCents: 310_00 - m * 10_00 })),
  },
  createdAt: minsAgo(1),
};

export const mandates: Mandate[] = [
  { _id: "mnd_kitchen", userId: "u_maya", agent: "watcher", label: "Kitchen upgrades", capCents: 500_00, spentCents: 0, categories: ["kitchen"], merchants: [], expiresAt: new Date("2026-11-30T00:00:00Z"), status: "active", card: { last4: "4821", token: "tok_mock_kitchen" } },
  { _id: "mnd_coffee", userId: "u_maya", agent: "smart_pay", label: "Coffee runs", capCents: 60_00, spentCents: 23_40, categories: ["coffee"], merchants: [], expiresAt: new Date("2026-10-31T00:00:00Z"), status: "active", card: { last4: "1177", token: "tok_mock_coffee" } },
];

export const approval: Approval = {
  _id: "apr_1",
  userId: "u_maya",
  kind: "purchase",
  status: "pending",
  amountCents: 449_95,
  productId: product._id,
  offerId: "ofr_1",
  mandateId: "mnd_kitchen",
  channel: "imessage",
  shortCode: "A7",
  expiresAt: new Date(now.getTime() + 30 * 60_000),
};

export const events: AgentEvent[] = [
  { _id: "evt_1", userId: "u_maya", ts: minsAgo(6), agent: "vision", surface: "imessage", type: "snap", summary: "Identified Breville Bambino Plus BES500 from your photo", refs: { productId: product._id } },
  { _id: "evt_2", userId: "u_maya", ts: minsAgo(5), agent: "worth_it", surface: "imessage", type: "verdict", summary: "Wait — likely to drop to ~$449.95", refs: { productId: product._id, verdictId: "vrd_1" } },
  { _id: "evt_3", userId: "u_maya", ts: minsAgo(4), agent: "watcher", surface: "imessage", type: "watch_created", summary: "Watching Bambino Plus at $449.95 or less", refs: { productId: product._id, mandateId: "mnd_kitchen" } },
  { _id: "evt_4", userId: "u_maya", ts: minsAgo(1), agent: "watcher", surface: "system", type: "price_drop", summary: "Bambino Plus dropped to $449.95 at Popover Kitchen", refs: { productId: product._id } },
  { _id: "evt_5", userId: "u_maya", ts: minsAgo(0), agent: "messenger", surface: "imessage", type: "approval_requested", summary: "Asked you to approve $449.95 on Visa ••4821", refs: { approvalId: "apr_1", mandateId: "mnd_kitchen" } },
];

export const stats: Stats = { savedCents: 412_50, rewardsEarnedCents: 38_20, purchases: 3, activeWatches: 2 };

export const snapResponse: SnapResponse = { product, offers, similar: [], verdict };
