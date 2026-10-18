// Owner: B. Rewards Optimizer (F6): which loyalty programs pay off for this user, in $/yr from their own merchant spend.
// Dollar estimates come only from real spend at the program's merchants; Vector Search adds a "fit" score for ranking.
import { HTTPException } from "hono/http-exception";
import { fmtUSD, type Enrollment, type RewardsProgram, type Surface } from "@alfred/shared";
import { collections } from "@alfred/shared/db";
import { emit } from "../core/events";
import { getEnrollments, getRewardsPrograms, hasDb, rewardsRelevance, spendByMerchant, type MerchantSpend } from "./data";
import { usd } from "./format";

/** Below this a program isn't worth the sign-up. */
const MIN_ANNUAL_CENTS = 5_00;
/** Feed events per scan; the rest are still recorded and listed, just not announced. */
const ANNOUNCE_TOP = 3;

export type RewardRecommendation = {
  programId: string;
  name: string;
  perks: string[];
  estAnnualValueCents: number;
  status: Enrollment["status"];
  /** 12-month spend and visits at the program's merchants. */
  spend12moCents: number;
  visits12mo: number;
  merchants: string[];
  /** One line for the card: where the $/yr comes from. */
  why: string;
  /** Vector Search fit to the user's spending profile (0–1), when available. */
  fit?: number;
};

/** Estimated $/yr from a year of spend at the program's merchants. */
export function annualValue(p: RewardsProgram, spend: MerchantSpend[]): { cents: number; spend: number; visits: number; merchants: string[] } {
  const mine = spend.filter((s) => p.merchantIds.includes(s.merchantId));
  const total = mine.reduce((a, s) => a + s.totalCents, 0);
  const visits = mine.reduce((a, s) => a + s.visits, 0);
  const v = p.valueModel;
  // per_visit and flat values are in cents; flat only pays if the user actually uses the merchant.
  const cents = Math.round(v.kind === "pct_back" ? total * v.value : v.kind === "per_visit" ? visits * v.value : total > 0 ? v.value : 0);
  return { cents, spend: total, visits, merchants: mine.map((s) => s.name) };
}

function why(p: RewardsProgram, a: ReturnType<typeof annualValue>): string {
  const where = a.merchants.join(" & ") || p.name;
  const v = p.valueModel;
  if (v.kind === "pct_back") return `${usd(a.spend)}/yr at ${where} × ${Math.round(v.value * 1000) / 10}% back`;
  if (v.kind === "per_visit") return `${a.visits} visits/yr to ${where} × ${fmtUSD(v.value)} each`; // cents matter here
  return `${usd(v.value)}/yr in perks — you already shop at ${where}`;
}

/**
 * Programs ranked by estimated $/yr from the user's own spend (Vector Search fit breaks ties). Newly worthwhile ones
 * are recorded as `recommended` enrollments and announced once with a `reward_recommended` event.
 */
export async function rewardsScan(userId: string, surface: Surface = "web"): Promise<RewardRecommendation[]> {
  const [programs, spend, enrollments] = await Promise.all([getRewardsPrograms(), spendByMerchant(userId), getEnrollments(userId)]);
  if (!programs.length) return [];
  const status = new Map(enrollments.map((e) => [e.programId, e.status]));
  const fit = await rewardsRelevance(profileText(spend)).catch(() => new Map<string, number>());

  const recs = programs
    .map((p) => {
      const a = annualValue(p, spend);
      return {
        programId: p._id, name: p.name, perks: p.perks, estAnnualValueCents: a.cents,
        status: status.get(p._id) ?? ("recommended" as const),
        spend12moCents: a.spend, visits12mo: a.visits, merchants: a.merchants, why: why(p, a),
        ...(fit.has(p._id) && { fit: Math.round(fit.get(p._id)! * 100) / 100 }),
      };
    })
    .filter((r) => r.status === "enrolled" || (r.status !== "dismissed" && r.estAnnualValueCents >= MIN_ANNUAL_CENTS))
    .sort((a, b) => b.estAnnualValueCents - a.estAnnualValueCents || (b.fit ?? 0) - (a.fit ?? 0));

  if (hasDb()) void announceNew(userId, recs.filter((r) => !status.has(r.programId)), surface);
  return recs;
}

/** Simulated one-tap enroll (DESIGN.md F6: no real loyalty sign-up). Idempotent. */
export async function enroll(userId: string, programId: string, surface: Surface = "web"): Promise<RewardRecommendation> {
  const recs = await rewardsScan(userId, surface);
  const rec = recs.find((r) => r.programId === programId);
  const program = rec ?? (await getRewardsPrograms()).find((p) => p._id === programId);
  if (!program) throw new HTTPException(404, { message: `unknown rewards program ${programId}` });
  const r: RewardRecommendation = rec ?? { programId, name: program.name, perks: program.perks, estAnnualValueCents: 0, status: "recommended", spend12moCents: 0, visits12mo: 0, merchants: [], why: "" };
  if (r.status === "enrolled") return r;
  if (!hasDb()) return { ...r, status: "enrolled" };

  const c = await collections();
  await c.enrollments.updateOne(
    { _id: enrollmentId(userId, programId) },
    { $set: { userId, programId, status: "enrolled", estAnnualValueCents: r.estAnnualValueCents } },
    { upsert: true },
  );
  await emit({
    userId, agent: "rewards", surface, type: "reward_enrolled",
    summary: `Joined ${r.name}${r.estAnnualValueCents ? ` — ~${usd(r.estAnnualValueCents)}/yr from your habits` : ""}`,
    refs: {},
  });
  return { ...r, status: "enrolled" };
}

const enrollmentId = (userId: string, programId: string) => `enr_${userId}_${programId}`;

/** Record recommendations the user hasn't seen and announce the best few. The deterministic _id makes concurrent scans
 *  insert once. `recs` is sorted by $/yr. */
async function announceNew(userId: string, recs: RewardRecommendation[], surface: Surface) {
  const c = await collections();
  let announced = 0;
  for (const r of recs) {
    try {
      await c.enrollments.insertOne({ _id: enrollmentId(userId, r.programId), userId, programId: r.programId, status: "recommended", estAnnualValueCents: r.estAnnualValueCents });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) continue; // already recorded by another scan/process
      console.warn("[rewards] recording recommendation failed:", (e as Error).message);
      continue;
    }
    if (announced++ < ANNOUNCE_TOP)
      await emit({ userId, agent: "rewards", surface, type: "reward_recommended", summary: `Join ${r.name} — ~${usd(r.estAnnualValueCents)}/yr (${r.why})`, refs: {} }).catch(() => {});
  }
}

/** A short natural-language spending profile for Vector Search. */
function profileText(spend: MerchantSpend[]) {
  const top = [...spend].sort((a, b) => b.totalCents - a.totalCents).slice(0, 8);
  return `I regularly spend at ${top.map((s) => `${s.name} (${s.category}, ${s.visits} visits, ${usd(s.totalCents)} a year)`).join("; ")}.`;
}
