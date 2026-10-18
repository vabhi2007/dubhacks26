// Owner: B. Worth-It (F2): Buy / Wait / Skip with reasons + math from the user's own history.
// Code computes every number; Claude chooses the verdict, which spend the product replaces, and the wording.
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Category, fmtUSD, type Offer, type Product, type Surface, type Verdict } from "@alfred/shared";
import { newId } from "@alfred/shared/db";
import { anthropic } from "./client";
import { usd } from "./format";
import { publishVerdict } from "./verdicts";
import { smartPay } from "./smartPay";
import { env } from "../env";
import {
  bestOffer, getOffers, getProduct, getUser, MIN_DIPS, monthToDateSpend, priceStats, recentPurchases, spendByCategory,
  type CategorySpend, type PastPurchase,
} from "./data";

export type WorthItInput = {
  userId: string;
  productId: string;
  /** Offers from the deal agent. Omit to load from Mongo / fixtures. */
  offers?: Offer[];
  /** Pass the resolved product to skip a lookup (e.g. fresh from /snap). */
  product?: Product;
  surface?: Surface;
};

const Judgment = z.object({
  kind: z.enum(["buy", "wait", "skip"]),
  headline: z.string().describe("≤ 90 chars, one sentence, leads with the decision's reason. Concrete numbers, no hedging."),
  reasons: z.array(z.string()).describe("2–4 bullets, each ≤ 120 chars with at least one concrete number from FACTS."),
  replacesCategory: Category.nullable().describe("Spend category this product would directly substitute (e.g. espresso machine → coffee), or null."),
});

const SYSTEM = `You are Alfred's Worth-It agent. You decide whether the user should buy a product now, wait for a better price, or skip it — using their real spending history, the way a frugal, honest friend with a spreadsheet would.

Rules:
- Use only numbers that appear in FACTS. Never invent prices, dates, or spend. Round money to whole dollars in prose.
- "buy": good value now (price at or near its typical low, fits budget, or clearly pays for itself).
- "wait": worth buying, but history shows a likely drop soon (expectedDrop > 0 with repeated dips) — say how much, and when if nextLikelySaleInDays is given ("next sale likely in about a week").
- "skip": poor value for this user — no matching habit, blows the budget, or duplicates what they already spend on. Say Skip when it's true; don't be a salesperson.
- If alreadyBoughtInCategory12mo shows the same or an overlapping product, lean Skip and say what they already own.
- Payback: only claim the product "pays for itself" if it genuinely replaces spending in replacesCategory. Use the precomputed paybackMonths for that category from FACTS.
- Headline ≤ 90 chars. Reasons: 2–4 bullets, each with a number. No filler like "it depends" or "consider your needs".`;

export async function worthIt(input: WorthItInput): Promise<Verdict> {
  const { userId, productId, surface = "system" } = input;
  const now = new Date();

  const product = input.product ?? (await getProduct(productId));
  if (!product) throw new Error(`worthIt: unknown product ${productId}`);
  const offers = input.offers?.length ? input.offers : await getOffers(productId);
  const best = bestOffer(offers);
  if (!best) throw new Error(`worthIt: no exact or variant offers for ${productId}`);

  const user = await getUser(userId);
  const monthlyBudget = user.settings.monthlyBudgets[product.category];
  const hasBudget = monthlyBudget != null;
  const [spend, mtd, history, owned, pay] = await Promise.all([
    spendByCategory(userId, now),
    hasBudget ? monthToDateSpend(userId, product.category, now) : 0,
    sellerPriceStats(productId, best, offers, now),
    recentPurchases(userId, product.category, now),
    smartPay({ userId, seller: best.seller, category: product.category, amountCents: best.priceCents }).catch(() => undefined),
  ]);

  const price = best.priceCents;
  // A $0 budget means "don't spend here": no finite ratio, but it must still count as over budget.
  const zeroBudget = monthlyBudget === 0;
  // Fraction of the monthly category budget (1.19 = 119%), matching fixtures' 0.36.
  const budgetImpactPct = hasBudget && !zeroBudget ? round(price / monthlyBudget, 2) : undefined;
  const expectedDropCents =
    history && history.dipsBelowRef >= MIN_DIPS ? Math.max(0, price - history.typicalLowCents) : 0;
  // Only meaningful alongside an expected drop: how long until that drop is likely to arrive.
  const expectedWaitDays = expectedDropCents > 0 ? history?.nextSaleInDays : undefined;
  const paybackByCategory = Object.fromEntries(
    spend.filter((s) => s.totalCents > 0).map((s) => [s.category, round(price / (s.totalCents / 12), 1)]),
  );

  const facts = {
    product: { title: product.title, brand: product.brand, category: product.category },
    bestOffer: { seller: best.seller, price: fmtUSD(price), condition: best.condition },
    otherOffers: offers
      .filter((o) => o._id !== best._id)
      .slice(0, 5)
      .map((o) => ({ seller: o.seller, price: fmtUSD(o.priceCents), condition: o.condition, matched: o.matched })),
    priceHistory90d: history && {
      low: fmtUSD(history.minCents),
      high: fmtUSD(history.maxCents),
      median: fmtUSD(history.medianCents),
      typicalWeeklyLow: fmtUSD(history.typicalLowCents),
      weeksDippedAtLeast5PctBelowBest: history.dipsBelowRef,
    },
    expectedDrop: fmtUSD(expectedDropCents),
    ...(expectedWaitDays !== undefined && { nextLikelySaleInDays: expectedWaitDays }),
    budget: !hasBudget
      ? { category: product.category, monthly: "no budget set" }
      : zeroBudget
        ? { category: product.category, monthly: "$0 — user chose not to spend in this category", spentThisMonth: fmtUSD(mtd) }
        : { category: product.category, monthly: fmtUSD(monthlyBudget), spentThisMonth: fmtUSD(mtd), priceAsPctOfMonthly: `${Math.round(budgetImpactPct! * 100)}%` },
    spend12mo: spend.slice(0, 8).map((s) => ({
      category: s.category,
      total: fmtUSD(s.totalCents),
      perMonth: fmtUSD(Math.round(s.totalCents / 12)),
      txCount: s.txCount,
      topMerchants: s.topMerchants.map((m) => `${m.name} ${fmtUSD(m.totalCents)}`),
      paybackMonthsIfReplaced: paybackByCategory[s.category],
    })),
    ...(pay && { bestCardToPayWith: { card: `${pay.name} ••${pay.last4}`, back: fmtUSD(pay.rewardCents), ratePct: pay.ratePct, cardLinkedOffer: Boolean(pay.offerId) } }),
    alreadyBoughtInCategory12mo: owned.map((o) => ({ title: o.title, price: fmtUSD(o.amountCents), sameProduct: o.productId === productId })),
  };

  const j = await judge(facts).catch((e) => {
    console.warn("[worth_it] Claude unavailable, using rule-based verdict:", (e as Error).message);
    return ruleBasedJudgment({ product, price, expectedDropCents, expectedWaitDays, budgetImpactPct, zeroBudget, spend, paybackByCategory, owned, productId });
  });

  const related = j.replacesCategory ? spend.find((s) => s.category === j.replacesCategory) : undefined;
  const reasons = j.reasons.filter(Boolean).slice(0, 4);
  const verdict: Verdict = {
    _id: newId("vrd"),
    userId,
    productId,
    kind: j.kind,
    mode: "worth_it",
    headline: j.headline,
    reasons: reasons.length ? reasons : [j.headline],
    math: {
      priceCents: price,
      bestOfferId: best._id,
      ...(related && { relatedSpend12moCents: related.totalCents, paybackMonths: paybackByCategory[related.category] }),
      ...(budgetImpactPct !== undefined && { budgetImpactPct }),
      expectedDropCents,
      ...(expectedWaitDays !== undefined && { expectedWaitDays }),
    },
    ...(pay && { smartPay: { cardId: pay.cardId, ...(pay.offerId && { offerId: pay.offerId }), rewardCents: pay.rewardCents } }),
    createdAt: now,
  };

  publishVerdict(verdict, surface, "worth_it");
  return verdict;
}

/**
 * Sellers whose price history may set the expected drop: only those with a new, exact-match offer for this product.
 * price_history is keyed by seller alone, so used/refurb/variant-only sellers (eBay used, Breville refurb, …) would
 * otherwise read as permanent "dips". The best offer's seller comes first when it qualifies.
 */
export function historySellers(best: Offer, offers: Offer[]): { own?: string; peers: string[] } {
  const ok = (o: Offer) => o.condition === "new" && o.matched === "exact";
  const peers = [...new Set(offers.filter(ok).map((o) => o.seller))];
  return { own: ok(best) ? best.seller : undefined, peers };
}

/** History for the best offer's seller; if it has none (e.g. a fresh SerpAPI offer), the other new exact sellers. */
async function sellerPriceStats(productId: string, best: Offer, offers: Offer[], now: Date) {
  const { own, peers } = historySellers(best, offers);
  const mine = own ? await priceStats(productId, best.priceCents, [own], now) : undefined;
  if (mine) return mine;
  const others = peers.filter((s) => s !== own);
  return others.length ? priceStats(productId, best.priceCents, others, now) : undefined;
}

async function judge(facts: object): Promise<z.infer<typeof Judgment>> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await anthropic.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Judgment) },
    system: SYSTEM,
    messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 2)}\n\nGive your verdict.` }],
  });
  if (res.stop_reason === "refusal") throw new Error("model declined");
  if (!res.parsed_output) throw new Error(`unparseable output (stop_reason=${res.stop_reason})`);
  return res.parsed_output;
}

// Keyword → spend category it substitutes. Only used when Claude is unavailable.
const SUBSTITUTES: [RegExp, Category][] = [
  [/espresso|coffee|nespresso|keurig|grinder/i, "coffee"],
  [/air fryer|instant pot|blender|cookware|rice cooker/i, "dining"],
  [/bike|scooter/i, "transport"],
];

/** Deterministic verdict so the mock path works with no API key (and survives API outages). */
function ruleBasedJudgment(a: {
  product: Product; productId: string; price: number; expectedDropCents: number; expectedWaitDays?: number; budgetImpactPct?: number; zeroBudget: boolean;
  spend: CategorySpend[]; paybackByCategory: Record<string, number>; owned: PastPurchase[];
}): z.infer<typeof Judgment> {
  const cat = SUBSTITUTES.find(([re]) => re.test(a.product.title))?.[1] ?? null;
  const related = cat ? a.spend.find((s) => s.category === cat) : undefined;
  const payback = related ? a.paybackByCategory[related.category] : undefined;
  const dup = a.owned.find((o) => o.productId === a.productId);
  const reasons: string[] = [];
  if (related && payback !== undefined)
    reasons.push(`You spent ${usd(related.totalCents)} on ${cat} in 12 months — pays back in ~${payback} months.`);
  if (a.expectedDropCents > 0) reasons.push(`Price has dipped ~${usd(a.expectedDropCents)} below ${usd(a.price)} recently.`);
  if (a.zeroBudget) reasons.push(`You set your ${a.product.category} budget to $0.`);
  else if (a.budgetImpactPct !== undefined) reasons.push(`${usd(a.price)} is ${Math.round(a.budgetImpactPct * 100)}% of your monthly ${a.product.category} budget.`);
  if (dup) reasons.push(`You already bought this for ${usd(dup.amountCents)} in the last year.`);

  let kind: "buy" | "wait" | "skip";
  let headline: string;
  const overBudget = (a.budgetImpactPct ?? 0) > 1;
  if (dup || a.zeroBudget || (!related && overBudget)) {
    kind = "skip";
    headline = dup ? `Skip — you already bought this ${dup.title}.`
      : a.zeroBudget ? `Skip — your ${a.product.category} budget is $0.` : `Skip — ${usd(a.price)} with no habit it replaces.`;
  } else if (a.expectedDropCents >= a.price * 0.05) {
    kind = "wait";
    headline = `Wait${a.expectedWaitDays ? ` ~${waitLabel(a.expectedWaitDays)}` : ""} — it usually dips ~${usd(a.expectedDropCents)} below today's price.`;
  } else if (payback !== undefined && payback <= 12) {
    kind = "buy";
    headline = `Buy — pays for itself in ~${payback} months from your ${cat} spend.`;
  } else if (!overBudget) {
    kind = "buy";
    headline = `Buy — ${usd(a.price)} fits your ${a.product.category} budget and isn't likely to drop.`;
  } else {
    kind = "skip";
    headline = `Skip — ${usd(a.price)} doesn't pay back from your spending.`;
  }
  return { kind, headline, reasons: reasons.slice(0, 4).length ? reasons.slice(0, 4) : [headline], replacesCategory: related ? cat : null };
}

const waitLabel = (days: number) => (days < 10 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.round(days / 7)} weeks`);
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
