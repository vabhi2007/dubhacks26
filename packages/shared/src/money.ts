export const fmtUSD = (cents: number, opts: { compact?: boolean } = {}) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.compact && Math.abs(cents) >= 100_00 ? 0 : 2,
  }).format(cents / 100);
