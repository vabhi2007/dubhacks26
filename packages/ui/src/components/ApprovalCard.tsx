"use client";
// ApprovalCard — pending approval with Approve / Deny, morphing to a Receipt on approve.
// Identical on web and iMessage deep links. MVP-0: states swap with no transition;
// the fade / Approval → Receipt morph is part of the MVP-3 motion pass.
import { useEffect, useRef, useState } from "react";
import type { Approval, Product } from "@alfred/shared";
import { fmtUSD } from "@alfred/shared";
import { cn } from "../cn";

export type ApprovalState = "pending" | "approved" | "denied" | "expired";

export function ApprovalCard({
  approval,
  product,
  state,
  cardBrand,
  cardLast4,
  rewardCents,
  busy,
  onApprove,
  onDeny,
  className,
}: {
  approval: Approval;
  product?: Pick<Product, "title">;
  /** Optional optimistic override, applied only while `approval.status` is still "pending". */
  state?: ApprovalState;
  /** Card network/name if known — contracts only store last4, so this is opt-in. */
  cardBrand?: string;
  cardLast4?: string;
  rewardCents?: number;
  busy?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  className?: string;
}) {
  // Expiry is enforced only in query filters (DESIGN.md §7), so a stored "pending" can be stale.
  // Check expiresAt here too, and flip to expired when it passes while the card is open.
  const expiresAtMs = new Date(approval.expiresAt).getTime();
  const [pastExpiry, setPastExpiry] = useState(() => expiresAtMs <= Date.now());
  useEffect(() => {
    const ms = expiresAtMs - Date.now();
    setPastExpiry(ms <= 0);
    if (Number.isNaN(ms) || ms <= 0 || ms > 2 ** 31 - 1) return; // setTimeout max delay
    const id = setTimeout(() => setPastExpiry(true), ms);
    return () => clearTimeout(id);
  }, [expiresAtMs]);

  // A non-pending approval must never render live buttons: a resolved status always beats `state`.
  const stored: ApprovalState = approval.status === "pending" && pastExpiry ? "expired" : approval.status;
  const effective: ApprovalState = stored === "pending" ? (state ?? "pending") : stored;

  // Lock after the first click so a double click can't send two decisions. Released when the
  // caller's `busy` changes (e.g. the request failed and busy went back to false) or the approval changes.
  const locked = useRef(false);
  const [acted, setActed] = useState(false);
  useEffect(() => {
    locked.current = false;
    setActed(false);
  }, [busy, approval._id]);
  const decide = (fn?: () => void) => () => {
    if (locked.current || busy) return;
    locked.current = true;
    setActed(true);
    fn?.();
  };

  const isEnroll = approval.kind === "enroll";
  const amount = fmtUSD(approval.amountCents);
  const cardSuffix = cardLast4 ? ` on ${cardBrand ? `${cardBrand} ` : ""}••${cardLast4}` : "";
  const title = product?.title ?? (isEnroll ? "this rewards program" : "this purchase");

  if (effective === "approved") {
    return (
      <div className={cn("rounded-card border border-buy/40 bg-buy/10 p-6", className)}>
        <div className="flex items-center gap-2 text-buy">
          <CheckIcon />
          <span className="text-sm font-medium uppercase tracking-wide">{isEnroll ? "Enrolled" : "Receipt"}</span>
        </div>
        <p className="mt-2 text-lg">
          {isEnroll ? (
            <>Enrolled in {title}.</>
          ) : (
            <>
              Paid <span className="num">{amount}</span>
              {cardSuffix} for {title}.
            </>
          )}
        </p>
        {!isEnroll && rewardCents != null ? (
          <p className="mt-1 text-sm text-text-muted">
            Earned <span className="num text-accent">+{fmtUSD(rewardCents)}</span> back.
          </p>
        ) : null}
      </div>
    );
  }

  if (effective === "denied" || effective === "expired") {
    const msg =
      effective === "expired"
        ? isEnroll
          ? `Expired — enrollment in ${title} is no longer available.`
          : `Expired — ${amount} for ${title} is no longer available to approve.`
        : isEnroll
          ? `Dismissed ${title}.`
          : `Declined ${amount} for ${title}.`;
    return (
      <div className={cn("rounded-card border border-border bg-surface p-6 opacity-70", className)}>
        <p className="text-sm text-text-muted">{msg}</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-card border border-accent/30 bg-surface p-6", className)}>
      <div className="text-xs uppercase tracking-wide text-accent">Approval needed · {approval.shortCode}</div>
      <p className="mt-2 text-lg">
        {isEnroll ? (
          <>Enroll in {title}?</>
        ) : (
          <>
            Approve <span className="num font-medium">{amount}</span>
            {cardSuffix} for {title}?
          </>
        )}
      </p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={decide(onApprove)}
          disabled={busy || acted}
          className="flex-1 rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {isEnroll ? "Enroll" : "Approve"}
        </button>
        <button
          type="button"
          onClick={decide(onDeny)}
          disabled={busy || acted}
          className="flex-1 rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {isEnroll ? "Dismiss" : "Deny"}
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
