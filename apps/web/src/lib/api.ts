// Typed client for the agent service (DESIGN.md §8.3).
// Routes may be absent (connection refused) or stubbed (501) while teammates build —
// readers fall back to @alfred/shared fixtures so the dashboard always renders.
import type { Approval, ApprovalDecision, ChatRequest, Mandate, Offer, Order, Product, Stats, Verdict, WishlistItem } from "@alfred/shared";
import * as fx from "@alfred/shared/fixtures";

export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";

// A response-with-error (4xx/5xx) carries `status`; a connection failure does not — callers
// use that to tell a real refusal apart from the agent being offline.
export interface ApiError extends Error {
  status?: number;
  body?: string;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`${res.status} ${path}${body ? `: ${body}` : ""}`) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json() as Promise<T>;
}

// The agent's /approvals returns each approval joined with display fields (same shape on fixtures).
export type ApprovalView = Approval & {
  product?: { title?: string };
  cardLast4?: string;
  cardBrand?: string;
  rewardCents?: number;
};

// Try the live route; on any failure (offline, 501, CORS) use the fixture.
async function withFallback<T>(fn: () => Promise<T>, fallback: T): Promise<{ data: T; live: boolean }> {
  try {
    return { data: await fn(), live: true };
  } catch {
    return { data: fallback, live: false };
  }
}

const fixtureApprovalView: ApprovalView = {
  ...fx.approval,
  product: { title: fx.product.title },
  cardLast4: fx.mandates.find((m) => m._id === fx.approval.mandateId)?.card.last4,
  rewardCents: fx.verdict.smartPay?.rewardCents,
};

export const getStats = () => withFallback<Stats>(() => api("/stats"), fx.stats);

export const getApprovals = (status: Approval["status"]) =>
  withFallback<ApprovalView[]>(
    () => api(`/approvals?status=${status}`),
    status === "pending" ? [fixtureApprovalView] : [],
  );

export const getPendingApprovals = () => getApprovals("pending");

// /verdicts responses carry the product's display info (B, #57) so surfaces can label the
// verdict without a product-fetch route.
export type VerdictView = Verdict & { product?: { title?: string; imageUrl?: string } };

// A single verdict by id. Home fetches this from the newest `verdict` event's verdictId for
// live updates. Returns null on 404/offline.
export async function getVerdict(id: string): Promise<VerdictView | null> {
  try {
    return await api<VerdictView>(`/verdicts/${id}`);
  } catch {
    return null;
  }
}

// The newest verdict (GET /verdicts?limit=1, added by B in #40), so Home shows the real latest
// verdict on first load before any in-session verdict event. Returns null when live-but-empty
// or the agent is offline — the caller keeps the empty state / fixture fallback.
export async function getLatestVerdict(): Promise<VerdictView | null> {
  try {
    const list = await api<VerdictView[]>("/verdicts?limit=1");
    return list[0] ?? null;
  } catch {
    return null;
  }
}

export const resolveApproval = (id: string, decision: ApprovalDecision["decision"]) =>
  api<{ approval: Approval; order?: Order }>(`/approvals/${id}`, {
    method: "POST",
    body: JSON.stringify({ decision, channel: "web" } satisfies ApprovalDecision),
  });

export const getMandates = () => withFallback<Mandate[]>(() => api("/mandates"), fx.mandates);

export const revokeMandate = (id: string) => api<Mandate>(`/mandates/${id}/revoke`, { method: "POST" });

export const adminPriceDrop = (body: { productId: string; newPriceCents: number }) =>
  api("/admin/price-drop", { method: "POST", body: JSON.stringify(body) });

export const adminReset = () => api("/admin/reset", { method: "POST" });

export const adminAdvanceTime = (days: number) =>
  api<{ ok: true; days: number; counts: Record<string, number> }>("/admin/advance-time", { method: "POST", body: JSON.stringify({ days }) });

// GET /wishlist joins each watch with its product + current best offer (WatchView on the agent).
export type WatchView = WishlistItem & {
  product?: { title?: string; imageUrl?: string };
  bestOffer?: { priceCents: number; seller?: string };
};

const fixtureWatch: WatchView = {
  _id: "wsh_fixture",
  userId: "u_maya",
  productId: fx.product._id,
  targetPriceCents: 150_00,
  status: "watching",
  product: { title: fx.product.title, imageUrl: fx.product.imageUrl },
  bestOffer: { priceCents: fx.offers[0].priceCents, seller: fx.offers[0].seller },
};

export const getWishlist = () => withFallback<WatchView[]>(() => api("/wishlist"), [fixtureWatch]);

export const createWatch = (productId: string, targetPriceCents: number) =>
  api<WishlistItem>("/wishlist", {
    method: "POST",
    body: JSON.stringify({ productId, targetPriceCents, surface: "web" }),
  });

// GET /timekeeper — upgrade now vs wait N months for the user's phone (B, #49). The agent reuses a
// verdict from the last 6h; `refresh` asks it to re-check. Fixture verdict when offline.
export const getTimekeeper = (refresh = false) =>
  withFallback<Verdict>(() => api(`/timekeeper${refresh ? "?refresh=1" : ""}`), fx.timekeeperVerdict);

// GET /products/:id (A, #67) returns { product, … }; we only need its display info. Null when unknown/offline.
export async function getProductInfo(id: string): Promise<{ title?: string; imageUrl?: string } | null> {
  try {
    return (await api<{ product: { title?: string; imageUrl?: string } }>(`/products/${id}`)).product;
  } catch {
    return null;
  }
}

// Full product page bundle from GET /products/:id (A) — everything /wishlist/[productId] needs in one call.
export type PriceHistoryPoint = { ts: string; priceCents: number; seller: string };
export type BreakEven = {
  priceCents: number;
  monthlySavingsCents: number;
  months: { month: number; cumulativeSavingsCents: number }[];
};
export type ProductDetail = {
  product: Product;
  offers: Offer[]; // ranked, best first
  priceHistory: PriceHistoryPoint[]; // 90d, oldest first
  latestVerdict: Verdict | null;
  watch: WishlistItem | null;
  breakEven: BreakEven | null;
};

// Deterministic 90-day series (gentle wave + weekend dips, recent slide toward target) for the
// offline fallback, so the detail charts still read without the agent.
function synthHistory(): PriceHistoryPoint[] {
  const base = 179_00;
  const today = Date.now();
  return Array.from({ length: 90 }, (_, k) => {
    const i = 89 - k;
    const ts = new Date(today - i * 86_400_000);
    const dow = ts.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? -20_00 : 0;
    const wave = Math.round(Math.sin(i / 7) * 12_00);
    const recentSlide = i < 10 ? -20_00 : 0;
    return { ts: ts.toISOString(), priceCents: Math.max(129_00, base + wave + weekend + recentSlide), seller: fx.offers[0].seller };
  });
}

function fixtureDetail(): ProductDetail {
  const monthly = Math.round((fx.verdict.math.relatedSpend12moCents ?? 0) / 12);
  return {
    product: fx.product,
    offers: fx.offers,
    priceHistory: synthHistory(),
    latestVerdict: fx.verdict,
    watch: { _id: "wsh_fixture", userId: "u_maya", productId: fx.product._id, targetPriceCents: 150_00, status: "watching" },
    breakEven: {
      priceCents: fx.verdict.math.priceCents,
      monthlySavingsCents: monthly,
      months: Array.from({ length: 10 }, (_, month) => ({ month, cumulativeSavingsCents: monthly * month })),
    },
  };
}

export const getProductDetail = (id: string) =>
  withFallback<ProductDetail>(() => api(`/products/${id}`), fixtureDetail());

// GET /rewards (B, #50): loyalty programs ranked by est. $/yr from the user's own merchant spend.
export type RewardRecommendation = {
  programId: string;
  name: string;
  perks: string[];
  estAnnualValueCents: number;
  status: "recommended" | "enrolled" | "dismissed";
  spend12moCents: number;
  visits12mo: number;
  merchants: string[];
  /** One line for the card: where the $/yr comes from. */
  why: string;
  fit?: number;
};

// Offline example mirroring the seed's u_maya, so the page still tells the story without the agent.
const fixtureRewards: RewardRecommendation[] = [
  { programId: "rwp_starbucks", name: "Starbucks Rewards", perks: ["2 Stars per $1 — a handcrafted drink every 100–200 Stars", "Free birthday drink"], estAnnualValueCents: 54_20, status: "recommended", spend12moCents: 404_45, visits12mo: 80, merchants: ["Starbucks"], why: "$404/yr at Starbucks × 13.4% back" },
  { programId: "rwp_chipotle", name: "Chipotle Rewards", perks: ["Points on every order", "Free chips & guac on your birthday"], estAnnualValueCents: 31_50, status: "recommended", spend12moCents: 393_72, visits12mo: 20, merchants: ["Chipotle"], why: "$394/yr at Chipotle × 8% back" },
  { programId: "rwp_tmobile_tuesdays", name: "T-Mobile Tuesdays", perks: ["Weekly freebies and partner deals"], estAnnualValueCents: 30_00, status: "enrolled", spend12moCents: 1020_00, visits12mo: 12, merchants: ["T-Mobile"], why: "$30/yr in perks — you already shop at T-Mobile" },
];

export const getRewards = () => withFallback<RewardRecommendation[]>(() => api("/rewards"), fixtureRewards);

// Simulated one-tap enroll (idempotent). Returns the program with status "enrolled".
export const enrollReward = (programId: string) =>
  api<RewardRecommendation>(`/rewards/${programId}/enroll`, { method: "POST", body: "{}" });

// POST /chat streams SSE frames: {delta}… then {done, verdictId?} (or {error} then {done}).
export type ChatFrame = { delta?: string; done?: boolean; verdictId?: string; error?: string };

// EventSource can't POST, so read the response body and split it into SSE frames by hand.
// Throws an ApiError like api() on a non-2xx response (no `status` = agent unreachable).
export async function* streamChat(text: string, signal?: AbortSignal): AsyncGenerator<ChatFrame> {
  const res = await fetch(`${AGENT_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, surface: "web" } satisfies ChatRequest),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    const err = new Error(`${res.status} /chat${body ? `: ${body}` : ""}`) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let end: number;
    while ((end = buf.indexOf("\n\n")) >= 0) {
      const data = buf
        .slice(0, end)
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      buf = buf.slice(end + 2);
      if (!data) continue;
      try {
        yield JSON.parse(data) as ChatFrame;
      } catch {
        // ignore a malformed frame
      }
    }
  }
}
