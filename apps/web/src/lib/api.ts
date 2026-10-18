// Typed client for the agent service (DESIGN.md §8.3).
// Routes may be absent (connection refused) or stubbed (501) while teammates build —
// readers fall back to @alfred/shared fixtures so the dashboard always renders.
import type { Approval, ApprovalDecision, Mandate, Order, Stats, Verdict } from "@alfred/shared";
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

export const getPendingApprovals = () =>
  withFallback<ApprovalView[]>(() => api("/approvals?status=pending"), [fixtureApprovalView]);

// There's no verdict list route yet (GET /verdicts/:id only). Home derives the latest verdict
// from the newest `verdict` event's verdictId and fetches it here. Returns null on 404/offline.
// TODO(B): a GET /verdicts?limit=1 would let Home show the latest verdict on first load too.
export async function getVerdict(id: string): Promise<Verdict | null> {
  try {
    return await api<Verdict>(`/verdicts/${id}`);
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
