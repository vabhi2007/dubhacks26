"use client";
// ApprovalCard — pending purchase approval with Approve / Deny, morphing to a Receipt
// on approve. Identical on web and iMessage deep links. MVP-0: simple fade between states;
// the Approval → Receipt morph is part of the MVP-3 motion pass.
import type { Approval, Product } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";

export type ApprovalState = "pending" | "approved" | "denied";

export function ApprovalCard({
  approval,
  product,
  state = "pending",
  cardLast4,
  rewardCents,
  busy,
  onApprove,
  onDeny,
  className,
}: {
  approval: Approval;
  product?: Pick<Product, "title">;
  state?: ApprovalState;
  cardLast4?: string;
  rewardCents?: number;
  busy?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  className?: string;
}) {
  const amount = fmtUSD(approval.amountCents);
  const card = cardLast4 ? ` on Visa ••${cardLast4}` : "";
  const title = product?.title ?? (approval.kind === "enroll" ? "rewards enrollment" : "this purchase");

  if (state === "approved") {
    return (
      <div className={cn("rounded-card border border-buy/40 bg-buy/10 p-6", className)}>
        <div className="flex items-center gap-2 text-buy">
          <CheckIcon />
          <span className="text-sm font-medium uppercase tracking-wide">Receipt</span>
        </div>
        <p className="mt-2 text-lg">
          Paid <span className="num">{amount}</span>
          {card} for {title}.
        </p>
        {rewardCents != null ? (
          <p className="mt-1 text-sm text-text-muted">
            Earned <span className="num text-accent">+{fmtUSD(rewardCents)}</span> back.
          </p>
        ) : null}
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className={cn("rounded-card border border-border bg-surface p-6 opacity-70", className)}>
        <p className="text-sm text-text-muted">
          Declined <span className="num">{amount}</span> for {title}.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-card border border-accent/30 bg-surface p-6", className)}>
      <div className="text-xs uppercase tracking-wide text-accent">Approval needed · {approval.shortCode}</div>
      <p className="mt-2 text-lg">
        Approve <span className="num font-medium">{amount}</span>
        {card} for {title}?
      </p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="flex-1 rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onDeny}
          disabled={busy}
          className="flex-1 rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13 4.5 6.5 11 3 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
