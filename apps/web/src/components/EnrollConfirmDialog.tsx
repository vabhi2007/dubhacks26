"use client";
// Asks whether the user actually finished joining a rewards program after we sent them to its sign-up page in a new
// tab — Alfred can't see that site, so the user's answer is the only signal. DESIGN.md §6: square, tokens, one primary
// (gold) action, a short fade (none under reduced motion). Accessible: role=dialog, labelled, Escape / backdrop = "Not yet".
import { useEffect, useId, useRef } from "react";

export function EnrollConfirmDialog({
  name,
  url,
  busy,
  onYes,
  onNo,
}: {
  name: string;
  url: string;
  busy?: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  const titleId = useId();
  const yesRef = useRef<HTMLButtonElement>(null);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "the sign-up page";
    }
  })();

  useEffect(() => {
    yesRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onNo();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNo]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden className="absolute inset-0 bg-bg/70 backdrop-blur-sm transition-opacity motion-reduce:transition-none" onClick={onNo} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="enter-up relative w-full max-w-sm border border-border bg-surface p-6 shadow-2xl"
      >
        <h2 id={titleId} className="font-serif text-[22px] leading-snug tracking-tight">
          Did you join {name}?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          We opened {host} in a new tab. Alfred can&apos;t see that site, so tell us if you finished signing up and we&apos;ll
          start counting it.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            ref={yesRef}
            type="button"
            onClick={onYes}
            disabled={busy}
            className="btn-gold rounded-control px-4 py-2 text-sm font-medium transition-[filter] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Yes, I joined"}
          </button>
          <button
            type="button"
            onClick={onNo}
            disabled={busy}
            className="rounded-control border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Not yet
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Open it again
          </a>
        </div>
      </div>
    </div>
  );
}
