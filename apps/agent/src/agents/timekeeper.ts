// Owner: B. Timekeeper (F8, T-Mobile): "upgrade now vs wait N months" for the user's phone.
// Code picks the month from device age, financing, the trade-in decay curve and urgency; Claude only writes the copy.
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { HTTPException } from "hono/http-exception";
import type { Device, Product, Surface, Verdict } from "@alfred/shared";
import { newId } from "@alfred/shared/db";
import * as fx from "@alfred/shared/fixtures";
import { env } from "../env";
import { anthropic } from "./client";
import { bestOffer, getDevice, getOffers, getProduct, getTradeInCurve, hasDb, listVerdicts } from "./data";
import { usd } from "./format";
import { publishVerdict } from "./verdicts";

/** Typical carrier installment term; financing ends this many months after purchase. */
const FINANCING_MONTHS = 24;
const HORIZON_MONTHS = 12;
/** What another month on a struggling phone is worth avoiding, in cents. */
const URGENCY = { lowBattery: 15_00, fullStorage: 10_00 };
/** Reuse a recent verdict for the same device + phone instead of re-asking Claude on every page load. */
const CACHE_MS = 6 * 60 * 60_000;

/** Upgrade target when none is given: the current model in the same family. */
const UPGRADE_TO: [RegExp, string][] = [
  [/iphone/i, "prd_iphone17"],
  [/pixel/i, "prd_pixel10"],
  [/galaxy/i, "prd_samsung_galaxy_s25"],
];

export type TimekeeperPlan = {
  device: Device;
  target: Product;
  priceCents: number;
  bestOfferId: string;
  ageMonths: number;
  financingMonthsLeft: number;
  monthlyPaymentCents: number;
  urgencyPerMonthCents: number;
  /** Out-of-pocket to upgrade in month m: price − trade-in(m) + financing still owed at m. */
  months: { month: number; tradeInCents: number; owedCents: number; costCents: number }[];
  waitMonths: number;
};

/** The deterministic part: cost of upgrading each month over the next year, and the best month to do it. */
export async function planUpgrade(userId: string, productId?: string, now = new Date()): Promise<TimekeeperPlan> {
  const device = await getDevice(userId);
  if (!device) throw new HTTPException(404, { message: `no device on file for ${userId}` });
  const targetId = productId ?? UPGRADE_TO.find(([re]) => re.test(device.model))?.[1];
  const target = targetId ? await getProduct(targetId) : undefined;
  if (!target) throw new HTTPException(404, { message: `no upgrade target for ${device.model}` });
  const best = bestOffer(await getOffers(target._id));
  if (!best) throw new HTTPException(404, { message: `no offers for ${target.title}` });
  const curve = await getTradeInCurve(device.model);

  const ageMonths = monthsBetween(device.purchasedAt, now);
  const financingMonthsLeft = device.financingRemainingCents > 0 ? Math.max(1, FINANCING_MONTHS - ageMonths) : 0;
  const monthlyPaymentCents = financingMonthsLeft ? Math.round(device.financingRemainingCents / financingMonthsLeft) : 0;
  const urgencyPerMonthCents =
    (device.batteryHealthPct < 80 ? URGENCY.lowBattery : 0) + (device.storageUsedPct >= 90 ? URGENCY.fullStorage : 0);

  const tradeIn = (m: number) => {
    const pts = curve?.points ?? [];
    return (pts.find((p) => p.month === m) ?? pts.filter((p) => p.month <= m).at(-1))?.valueCents ?? 0;
  };
  const horizon = Math.min(HORIZON_MONTHS, curve ? Math.max(...curve.points.map((p) => p.month)) : HORIZON_MONTHS);
  const months = Array.from({ length: horizon + 1 }, (_, month) => {
    const owedCents = Math.max(0, device.financingRemainingCents - monthlyPaymentCents * month);
    const tradeInCents = tradeIn(month);
    return { month, tradeInCents, owedCents, costCents: best.priceCents - tradeInCents + owedCents };
  });
  // Cheapest month once urgency is priced in; ties go to the earlier month.
  const score = (m: (typeof months)[number]) => m.costCents + urgencyPerMonthCents * m.month;
  const waitMonths = months.reduce((a, b) => (score(b) < score(a) ? b : a)).month;

  return { device, target, priceCents: best.priceCents, bestOfferId: best._id, ageMonths, financingMonthsLeft, monthlyPaymentCents, urgencyPerMonthCents, months, waitMonths };
}

const Copy = z.object({
  headline: z.string().describe("≤ 90 chars. Leads with the decision (\"Upgrade now\" or \"Wait N months\") and the number that drives it."),
  reasons: z.array(z.string()).describe("2–4 bullets, each ≤ 120 chars with at least one concrete number from FACTS."),
});

const SYSTEM = `You are Alfred's Timekeeper, a T-Mobile upgrade advisor. Code has already chosen the month to upgrade (DECISION); explain it in plain language.
- Use only numbers from FACTS; money in whole dollars. Never contradict DECISION.
- Say why: trade-in value lost by waiting, financing still owed, battery/storage health, and any trade-in cliff (a month where the value drops sharply).
- Headline ≤ 90 chars. Reasons: 2–4 bullets, each with a number. No hedging or filler.`;

/** Timekeeper verdict for the user's current device. Reuses a recent one unless `refresh`. */
export async function timekeeper(a: { userId: string; productId?: string; surface?: Surface; refresh?: boolean }): Promise<Verdict> {
  let plan: TimekeeperPlan;
  try {
    plan = await planUpgrade(a.userId, a.productId);
  } catch (e) {
    // Mock path (no DB): the fixture catalog has no phones, so keep serving the fixture verdict like the old stub.
    if (!hasDb() && !a.productId) return fx.timekeeperVerdict;
    throw e;
  }
  if (!a.refresh) {
    const recent = (await listVerdicts(a.userId, 20)).find(
      (v) => v.mode === "timekeeper" && v.productId === plan.target._id && Date.now() - new Date(v.createdAt).getTime() < CACHE_MS,
    );
    if (recent && recent.timekeeper?.waitMonths === plan.waitMonths) return recent;
  }

  const now = plan.months[0]!;
  const later = plan.months[plan.waitMonths]!;
  const copy = await write(plan).catch((e) => {
    console.warn("[timekeeper] Claude unavailable, using rule-based copy:", (e as Error).message);
    return ruleCopy(plan);
  });
  const reasons = copy.reasons.filter(Boolean).slice(0, 4);
  const verdict: Verdict = {
    _id: newId("vrd"),
    userId: a.userId,
    productId: plan.target._id,
    kind: plan.waitMonths === 0 ? "buy" : "wait",
    mode: "timekeeper",
    headline: copy.headline,
    reasons: reasons.length ? reasons : [copy.headline],
    // expectedDropCents is a price drop on Worth-It cards; the saving here lives in timekeeper.costNow/costLater.
    math: { priceCents: plan.priceCents, bestOfferId: plan.bestOfferId },
    timekeeper: {
      waitMonths: plan.waitMonths,
      costNowCents: now.costCents,
      costLaterCents: later.costCents,
      tradeInSeries: plan.months.map((m) => ({ month: m.month, valueCents: m.tradeInCents })),
    },
    createdAt: new Date(),
  };
  publishVerdict(verdict, a.surface ?? "web", "timekeeper");
  return verdict;
}

async function write(plan: TimekeeperPlan): Promise<z.infer<typeof Copy>> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const { device, target, months, waitMonths } = plan;
  const cliff = biggestDrop(plan);
  const facts = {
    device: { model: device.model, ageMonths: plan.ageMonths, batteryHealthPct: device.batteryHealthPct, storageUsedPct: device.storageUsedPct },
    financing: { owedNow: usd(device.financingRemainingCents), monthsLeft: plan.financingMonthsLeft, monthly: usd(plan.monthlyPaymentCents) },
    upgradeTo: { title: target.title, price: usd(plan.priceCents) },
    byMonth: months.map((m) => ({ month: m.month, tradeIn: usd(m.tradeInCents), stillOwed: usd(m.owedCents), outOfPocket: usd(m.costCents) })),
    tradeInCliff: cliff && { month: cliff.month, drop: usd(cliff.dropCents) },
    urgencyPerMonth: usd(plan.urgencyPerMonthCents),
  };
  const decision = waitMonths === 0 ? "Upgrade now" : `Wait ${waitMonths} month${waitMonths > 1 ? "s" : ""}`;
  const res = await anthropic.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Copy) },
    system: SYSTEM,
    messages: [{ role: "user", content: `DECISION: ${decision}\nFACTS:\n${JSON.stringify(facts, null, 2)}` }],
  });
  if (res.stop_reason === "refusal") throw new Error("model declined");
  if (!res.parsed_output) throw new Error(`unparseable output (stop_reason=${res.stop_reason})`);
  return res.parsed_output;
}

/** Deterministic copy so the mock path works with no API key. */
function ruleCopy(plan: TimekeeperPlan): z.infer<typeof Copy> {
  const { device, months, waitMonths } = plan;
  const now = months[0]!;
  const later = months[waitMonths]!;
  const cliff = biggestDrop(plan);
  const reasons = [
    `Battery health is ${device.batteryHealthPct}% and storage is ${device.storageUsedPct}% full.`,
    device.financingRemainingCents > 0
      ? `You still owe ${usd(device.financingRemainingCents)} on your ${device.model}, paid off in ${plan.financingMonthsLeft} months.`
      : `Your ${device.model} is paid off.`,
    `Trade-in is ${usd(now.tradeInCents)} today${waitMonths ? ` and ${usd(later.tradeInCents)} in ${waitMonths} months` : ""}.`,
    ...(cliff ? [`Trade-in drops ${usd(cliff.dropCents)} in month ${cliff.month}.`] : []),
  ];
  const headline =
    waitMonths === 0
      ? `Upgrade now — waiting only costs you more (${usd(now.costCents)} out of pocket today).`
      : `Wait ${waitMonths} months — ${usd(now.costCents - later.costCents)} less out of pocket than upgrading today.`;
  return { headline, reasons: reasons.slice(0, 4) };
}

/** The largest single-month trade-in drop within the horizon (the "cliff"), if it's notably steeper than usual. */
function biggestDrop(plan: TimekeeperPlan) {
  const drops = plan.months.slice(1).map((m, i) => ({ month: m.month, dropCents: plan.months[i]!.tradeInCents - m.tradeInCents }));
  const top = drops.reduce((a, b) => (b.dropCents > a.dropCents ? b : a), { month: 0, dropCents: 0 });
  const typical = drops.map((d) => d.dropCents).sort((a, b) => a - b)[Math.floor(drops.length / 2)] ?? 0;
  return top.dropCents > typical * 2 ? top : undefined;
}

function monthsBetween(from: Date, to: Date) {
  const f = new Date(from);
  let m = (to.getUTCFullYear() - f.getUTCFullYear()) * 12 + (to.getUTCMonth() - f.getUTCMonth());
  if (to.getUTCDate() < f.getUTCDate()) m--;
  return Math.max(0, m);
}
