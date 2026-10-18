// Typed client for the agent service (DESIGN.md §8.3).
// Routes may be absent (connection refused) or stubbed (501) while teammates build —
// every reader falls back to @alfred/shared fixtures so the dashboard always renders.
import type { Approval, ApprovalDecision, Stats, Verdict } from "@alfred/shared";
import * as fx from "@alfred/shared/fixtures";

export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8787";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

// Try the live route; on any failure (offline, 501, CORS) use the fixture.
async function withFallback<T>(fn: () => Promise<T>, fallback: T): Promise<{ data: T; live: boolean }> {
  try {
    return { data: await fn(), live: true };
  } catch {
    return { data: fallback, live: false };
  }
}

export const getStats = () => withFallback<Stats>(() => api("/stats"), fx.stats);

export const getPendingApprovals = () =>
  withFallback<Approval[]>(() => api("/approvals?status=pending"), [fx.approval]);

// No list route for verdicts yet (GET /verdicts/:id only) — seed with the fixture;
// live verdicts arrive over the /events SSE stream.
export const getLatestVerdict = async (): Promise<{ data: Verdict; live: boolean }> => ({
  data: fx.verdict,
  live: false,
});

export const resolveApproval = (id: string, decision: ApprovalDecision["decision"]) =>
  api<Approval>(`/approvals/${id}`, {
    method: "POST",
    body: JSON.stringify({ decision, channel: "web" } satisfies ApprovalDecision),
  });

export const adminPriceDrop = (body: { productId: string; newPriceCents: number }) =>
  api("/admin/price-drop", { method: "POST", body: JSON.stringify(body) });

export const adminReset = () => api("/admin/reset", { method: "POST" });
