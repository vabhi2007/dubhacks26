// Typed client for the agent service (DESIGN.md §8.3).
// Routes may be absent (connection refused) or stubbed (501) while teammates build —
// readers fall back to @alfred/shared fixtures so the dashboard always renders.
import type { Approval, ApprovalDecision, Mandate, Order, Stats, Verdict, WishlistItem } from "@alfred/shared";
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
