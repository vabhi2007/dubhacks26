// Reference component showing token usage. Owner: D — build VerdictCard, ApprovalCard, etc. alongside (DESIGN.md §6).
import type { Verdict } from "@alfred/shared";
import { cn } from "../cn";

const styles: Record<Verdict["kind"], string> = {
  buy: "text-buy bg-buy/10",
  wait: "text-wait bg-accent-subtle",
  skip: "text-skip bg-skip/10",
};

export function VerdictBadge({ kind, className }: { kind: Verdict["kind"]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-none px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide", styles[kind], className)}>
      {kind}
    </span>
  );
}
