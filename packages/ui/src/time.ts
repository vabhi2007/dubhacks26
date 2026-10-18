// Compact relative-time for feed rows. Pure, no deps.
export function relativeTime(input: Date | string, now: Date = new Date()): string {
  const then = typeof input === "string" ? new Date(input) : input;
  const sec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
