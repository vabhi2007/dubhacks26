// Owner: C. Bound a DB lookup so an unreachable Atlas falls back fast instead of waiting out the driver's 30s
// server-selection timeout. The underlying operation isn't cancelled; its result is just ignored.
export const LOOKUP_MS = 3_000;

export function withTimeout<T>(p: Promise<T>, ms = LOOKUP_MS, what = "lookup"): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
