// Owner: B. Return tracker (F5): every purchase's return window, and a nudge when the price drops while it's still open.
// Windows are retailers' typical published standard policies (not per-order terms), so the UI says "typical" and an
// unknown seller gets a conservative default marked as an estimate.
import type { Category, Order } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { bestOffer, getOffers, getProduct, hasDb } from "./data";

const DAY = 86_400_000;
const DEFAULT_DAYS = 30;
/** "Closing soon" when this few days are left. */
const SOON_DAYS = 7;

type Policy = { days: number; electronicsDays?: number } | { days: null; note: string };

/** Typical standard return windows (days from purchase) for the sellers in our catalog and live results. */
const POLICIES: Record<string, Policy> = {
  amazon: { days: 30 },
  apple: { days: 14 },
  "b&h photo": { days: 30 },
  "back market": { days: 30 },
  "best buy": { days: 15 },
  breville: { days: 30 },
  costco: { days: 90 },
  "google store": { days: 15 },
  ikea: { days: 365 },
  nordstrom: { days: 90 },
  rei: { days: 90 },
  "sur la table": { days: 30 },
  "t-mobile": { days: 14 },
  target: { days: 90, electronicsDays: 30 },
  uniqlo: { days: 30 },
  walgreens: { days: 30 },
  walmart: { days: 90, electronicsDays: 30 },
  wayfair: { days: 30 },
  "williams sonoma": { days: 30 },
  zappos: { days: 365 },
  // Marketplaces: the individual seller sets the terms.
  ebay: { days: null, note: "Set by the eBay seller" },
  mercari: { days: null, note: "Mercari: 3 days after delivery to report a problem" },
  swappa: { days: null, note: "Set by the Swappa seller" },
};

const norm = (s: string) => s.toLowerCase().replace(/\.com$/, "").replace(/\s+-\s+.*$/, "").trim();

export type ReturnWindow = {
  orderId: string;
  productId: string;
  title: string;
  imageUrl?: string;
  seller: string;
  amountCents: number;
  boughtAt: Date;
  /** null when the marketplace seller sets the terms. */
  windowDays: number | null;
  returnBy?: Date;
  daysLeft?: number;
  status: "open" | "closing" | "closed" | "seller";
  /** True when the window is a default guess (unknown seller), not a known policy. */
  estimated: boolean;
  policyNote?: string;
  /** Today's best price, when it's lower than what was paid and the window is still open. */
  priceDrop?: { nowCents: number; seller: string; savingsCents: number };
};

export function returnPolicy(seller: string, category: Category): { days: number | null; estimated: boolean; note?: string } {
  const p = POLICIES[norm(seller)];
  if (!p) return { days: DEFAULT_DAYS, estimated: true };
  if (p.days === null) return { days: null, estimated: false, note: p.note };
  return { days: category === "electronics" && p.electronicsDays ? p.electronicsDays : p.days, estimated: false };
}

/** Every purchase with its return window, open ones first (soonest deadline first), then seller-set, then closed. */
export async function listReturns(userId: string, now = new Date()): Promise<ReturnWindow[]> {
  if (!hasDb()) return [];
  const c = await collections();
  const orders = (await c.orders.find({ userId }).sort({ ts: -1 }).limit(100).toArray()) as (Order & { seller?: string })[];
  if (!orders.length) return [];
  const offers = new Map(
    (await c.offers.find({ _id: { $in: orders.filter((o) => !o.seller).map((o) => o.offerId) } }).toArray()).map((o) => [o._id, o.seller]),
  );

  const rows = await Promise.all(
    orders.map(async (o): Promise<ReturnWindow> => {
      const product = await getProduct(o.productId);
      const seller = o.seller ?? offers.get(o.offerId) ?? "Unknown seller";
      const policy = returnPolicy(seller, product?.category ?? "other");
      const boughtAt = new Date(o.ts);
      const base = {
        orderId: o._id, productId: o.productId, title: product?.title ?? o.productId,
        ...(product?.imageUrl && { imageUrl: product.imageUrl }),
        seller, amountCents: o.amountCents, boughtAt, windowDays: policy.days, estimated: policy.estimated,
        ...(policy.note && { policyNote: policy.note }),
      };
      if (policy.days === null) return { ...base, status: "seller" };

      const returnBy = new Date(boughtAt.getTime() + policy.days * DAY);
      const daysLeft = Math.ceil((returnBy.getTime() - now.getTime()) / DAY);
      const status = daysLeft <= 0 ? "closed" : daysLeft <= SOON_DAYS ? "closing" : "open";
      // Only worth saying while a return (or a price adjustment) is still possible.
      const best = status === "closed" ? undefined : bestOffer(await getOffers(o.productId));
      const priceDrop = best && best.priceCents < o.amountCents
        ? { nowCents: best.priceCents, seller: best.seller, savingsCents: o.amountCents - best.priceCents }
        : undefined;
      return { ...base, returnBy, daysLeft: Math.max(0, daysLeft), status, ...(priceDrop && { priceDrop }) };
    }),
  );

  const rank = { closing: 0, open: 1, seller: 2, closed: 3 } as const;
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || +b.boughtAt - +a.boughtAt);
}
