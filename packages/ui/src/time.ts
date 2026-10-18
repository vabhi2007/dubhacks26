// Time helpers for feed rows. Pure, no deps. All guard against invalid dates.
export function relativeTime(input: Date | string, now: Date = new Date()): string {
  const then = typeof input === "string" ? new Date(input) : input;
  const t = then.getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.round((now.getTime() - t) / 1000);
  if (sec < 45) return "just now"; // also covers small clock skew / future timestamps
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic absolute label (UTC) — safe to render on the server without a
// timezone/locale hydration mismatch. Used as the pre-mount placeholder for feed rows.
export function shortDate(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Valid ISO string or undefined — never throws on a bad date.
export function isoOrUndefined(input: Date | string): string | undefined {
  const d = typeof input === "string" ? new Date(input) : input;
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
