// Watch target for the Watcher (B): it buys as soon as the best price is ≤ target, so the target
// must be strictly below today's price — otherwise "Watch" is an immediate purchase. Use the
// expected drop when there is one, else a default 10% off; undefined if neither fits.
const DEFAULT_DISCOUNT = 0.1;

export function watchTarget(priceCents: number, expectedDropCents = 0): number | undefined {
  const t =
    expectedDropCents > 0 && expectedDropCents < priceCents
      ? priceCents - expectedDropCents
      : Math.floor(priceCents * (1 - DEFAULT_DISCOUNT));
  return t >= 1 && t < priceCents ? t : undefined;
}
