// Whole dollars for agent prose. fmtUSD's compact mode still prints cents under $100 ("$30.00").
export const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
