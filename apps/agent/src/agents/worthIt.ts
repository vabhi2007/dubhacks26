// Owner: B. Worth-It (F2): Buy / Wait / Skip with reasons + math from the user's own history.
// Code computes every number; Claude chooses the verdict, which spend the product replaces, and the wording.
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Category, fmtUSD, type Offer, type Product, type Surface, type Verdict } from "@alfred/shared";
import { collections, newId } from "@alfred/shared/db";
import { emit } from "../core/events";
import { anthropic } from "./client";
import { bestOffer, getOffers, getProduct, getUser, hasDb, monthToDateSpend, priceStats, spendByCategory } from "./data";

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
- "wait": worth buying, but history shows a likely drop soon (expectedDrop > 0 with repeated dips) — say how much and roughly how often.
- "skip": poor value for this user — no matching habit, blows the budget, or duplicates what they already spend on. Say Skip when it's true; don't be a salesperson.
- Payback: only claim the product "pays for itself" if it genuinely replaces spending in replacesCategory. Use the precomputed paybackMonths for that category from FACTS.
- Headline ≤ 90 chars. Reasons: 2–4 bullets, each with a number. No filler like "it depends" or "consider your needs".`;

export async function worthIt(input: WorthItInput): Promise<Verdict> {
  const { userId, productId, surface = "system" } = input;
  const now = new Date();

  const product = input.product ?? (await getProduct(productId));
  if (!product) throw new Error(`worthIt: unknown product ${productId}`);
  const offers = input.offers?.length ? input.offers : await getOffers(productId);
  const best = bestOffer(offers);
  if (!best) throw new Error(`worthIt: no offers for ${productId}`);

  const [user, spend, mtd, history] = await Promise.all([
    getUser(userId),
    spendByCategory(userId, now),
    monthToDateSpend(userId, product.category, now),
    priceStats(productId, best.priceCents, now),
  ]);

  const price = best.priceCents;
  const monthlyBudget = user.settings.monthlyBudgets[product.category];
  const budgetImpactPct = monthlyBudget ? round(price / monthlyBudget, 2) : undefined;
  const expectedDropCents =
    history && history.dipsBelowRef > 0 ? Math.max(0, price - history.typicalLowCents) : 0;
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
    budget: monthlyBudget
      ? { category: product.category, monthly: fmtUSD(monthlyBudget), spentThisMonth: fmtUSD(mtd), priceAsPctOfMonthly: `${Math.round(budgetImpactPct! * 100)}%` }
      : { category: product.category, monthly: "no budget set" },
    spend12mo: spend.slice(0, 8).map((s) => ({
      category: s.category,
      total: fmtUSD(s.totalCents),
      perMonth: fmtUSD(Math.round(s.totalCents / 12)),
      txCount: s.txCount,
      topMerchants: s.topMerchants.map((m) => `${m.name} ${fmtUSD(m.totalCents)}`),
      paybackMonthsIfReplaced: paybackByCategory[s.category],
    })),
  };

  const res = await anthropic.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Judgment) },
    system: SYSTEM,
    messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 2)}\n\nGive your verdict.` }],
  });
  if (res.stop_reason === "refusal") throw new Error("worthIt: model declined");
  const j = res.parsed_output;
  if (!j) throw new Error(`worthIt: unparseable output (stop_reason=${res.stop_reason})`);

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
    },
    createdAt: now,
  };

  if (hasDb()) {
    const c = await collections();
    await c.verdicts.insertOne(verdict);
    await emit({
      userId,
      agent: "worth_it",
      surface,
      type: "verdict",
      summary: `${label(verdict.kind)} — ${verdict.headline}`,
      refs: { productId, verdictId: verdict._id },
    });
  }
  return verdict;
}

const label = (k: Verdict["kind"]) => ({ buy: "Buy", wait: "Wait", skip: "Skip" })[k];
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
