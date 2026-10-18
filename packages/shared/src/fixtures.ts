// Static fixtures matching the frozen contracts. UI and extension build against these until routes are live.
import type { AgentEvent, Approval, Mandate, Offer, Product, SnapResponse, Stats, Verdict } from "./schemas";

const now = new Date("2026-10-18T17:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

export const product: Product = {
  _id: "prd_bambino",
  title: "Breville Bambino Espresso Machine",
  brand: "Breville",
  model: "BES450",
  category: "kitchen",
  imageUrl: "https://placehold.co/400x400/141416/E2A829?text=Bambino",
  source: "mock",
  canonicalKey: "breville-bes450",
};

export const offers: Offer[] = [
  { _id: "ofr_1", productId: product._id, seller: "Popover Kitchen", priceCents: 179_00, condition: "new", region: "US", matched: "exact", fetchedAt: now, url: "https://example.com/1" },
  { _id: "ofr_2", productId: product._id, seller: "Best Buy", priceCents: 299_95, condition: "new", region: "US", matched: "exact", fetchedAt: now, url: "https://example.com/2" },
  { _id: "ofr_3", productId: product._id, seller: "eBay", priceCents: 129_00, condition: "used", region: "US", matched: "exact", fetchedAt: now, url: "https://example.com/3" },
];

export const verdict: Verdict = {
  _id: "vrd_1",
  userId: "u_maya",
  productId: product._id,
  kind: "wait",
  mode: "worth_it",
  headline: "Pays for itself in 3.5 months — but it usually drops on weekends.",
  reasons: [
    "You spent $640 at cafés in the last 12 months.",
    "Best new US price is $179 at Popover Kitchen ($71 under Best Buy).",
    "This model dipped to $149 three times in the last 90 days.",
  ],
  math: { priceCents: 179_00, bestOfferId: "ofr_1", paybackMonths: 3.5, relatedSpend12moCents: 640_00, budgetImpactPct: 0.36, expectedDropCents: 30_00 },
  smartPay: { cardId: "crd_sig", rewardCents: 4_47 },
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
  { _id: "mnd_kitchen", userId: "u_maya", agent: "watcher", label: "Kitchen upgrades", capCents: 200_00, spentCents: 0, categories: ["kitchen"], merchants: [], expiresAt: new Date("2026-11-30T00:00:00Z"), status: "active", card: { last4: "4821", token: "tok_mock_kitchen" } },
  { _id: "mnd_coffee", userId: "u_maya", agent: "smart_pay", label: "Coffee runs", capCents: 60_00, spentCents: 23_40, categories: ["coffee"], merchants: [], expiresAt: new Date("2026-10-31T00:00:00Z"), status: "active", card: { last4: "1177", token: "tok_mock_coffee" } },
];

export const approval: Approval = {
  _id: "apr_1",
  userId: "u_maya",
  kind: "purchase",
  status: "pending",
  amountCents: 149_00,
  productId: product._id,
  offerId: "ofr_1",
  mandateId: "mnd_kitchen",
  channel: "imessage",
  shortCode: "A7",
  expiresAt: new Date(now.getTime() + 30 * 60_000),
};

export const events: AgentEvent[] = [
  { _id: "evt_1", userId: "u_maya", ts: minsAgo(6), agent: "vision", surface: "imessage", type: "snap", summary: "Identified Breville Bambino from your photo", refs: { productId: product._id } },
  { _id: "evt_2", userId: "u_maya", ts: minsAgo(5), agent: "worth_it", surface: "imessage", type: "verdict", summary: "Wait — likely to drop to ~$149", refs: { productId: product._id, verdictId: "vrd_1" } },
  { _id: "evt_3", userId: "u_maya", ts: minsAgo(4), agent: "watcher", surface: "imessage", type: "watch_created", summary: "Watching Bambino under $150", refs: { productId: product._id, mandateId: "mnd_kitchen" } },
  { _id: "evt_4", userId: "u_maya", ts: minsAgo(1), agent: "watcher", surface: "system", type: "price_drop", summary: "Bambino dropped to $149 at Popover Kitchen", refs: { productId: product._id } },
  { _id: "evt_5", userId: "u_maya", ts: minsAgo(0), agent: "messenger", surface: "imessage", type: "approval_requested", summary: "Asked you to approve $149 on Visa ••4821", refs: { approvalId: "apr_1", mandateId: "mnd_kitchen" } },
];

export const stats: Stats = { savedCents: 412_50, rewardsEarnedCents: 38_20, purchases: 3, activeWatches: 2 };

export const snapResponse: SnapResponse = { product, offers, similar: [], verdict };
