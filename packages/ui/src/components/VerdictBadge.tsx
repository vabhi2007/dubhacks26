// Reference component showing token usage. Owner: D — build VerdictCard, ApprovalCard, etc. alongside (DESIGN.md §6).
import type { Verdict } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";

const styles: Record<Verdict["kind"], string> = {
  buy: "text-buy bg-buy/10",
  wait: "text-wait bg-accent-subtle",
  skip: "text-skip bg-skip/10",
};

/** `detail` qualifies the verdict, e.g. how long to wait: "WAIT · 4 MO". */
export function VerdictBadge({ kind, detail, className }: { kind: Verdict["kind"]; detail?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-none px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide", styles[kind], className)}>
      {kind}
      {detail ? (
        <>
          <span aria-hidden className="opacity-60">·</span>
          <span className="num font-semibold normal-case">{detail}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * What a "wait" verdict is waiting for, short enough for the badge. Timekeeper: how long ("4 mo" — computed from
 * financing and the trade-in curve). Worth-It: the price it has dropped to ("~$149") — never a day count, since sales
 * don't follow a schedule.
 */
export function waitDetail(v: Verdict): string | undefined {
  if (v.kind !== "wait") return undefined;
  const months = v.timekeeper?.waitMonths;
  if (months != null && months > 0) return `${Math.round(months * 10) / 10} mo`;
  const drop = v.math.expectedDropCents;
  if (drop && drop > 0) return `~${fmtUSD(v.math.priceCents - drop, { compact: true })}`;
  return undefined;
}
