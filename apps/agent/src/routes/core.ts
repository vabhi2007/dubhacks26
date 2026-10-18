// Owner: A. Platform routes (DESIGN.md §8.3). Without MONGODB_URI, GETs fall back to fixtures and writes return 503.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import * as fx from "@alfred/shared/fixtures";
import { AdminAdvanceTime, AdminPriceDrop, Approval, ApprovalDecision, type AgentEvent } from "@alfred/shared";
import { env } from "../env";
import { priceDrop, resetDemo } from "../core/admin";
import { listApprovals } from "../core/approvals";
import { recentEvents } from "../core/events";
import { listMandates, revokeMandate } from "../core/mandates";
import { resolveApproval } from "../core/purchase";
import { subscribe } from "../core/sse";
import { getStats } from "../core/stats";

export const core = new Hono();
const userId = env.DEMO_USER_ID;
const live = Boolean(env.MONGODB_URI);
const needDb = () => {
  if (!live) throw new HTTPException(503, { message: "MONGODB_URI not set — running on fixtures" });
};

// SSE of AgentEvents. On connect, replays recent events oldest-first (`?replay=N`, default 50, 0 = none; or everything
// after the Last-Event-ID header on reconnect), then streams live. Each message has `id: <event _id>` — dedupe by it.
core.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = (e: AgentEvent) => stream.writeSSE({ id: e._id, event: "agent_event", data: JSON.stringify(e) });
    let queued: AgentEvent[] | null = []; // live events that arrive while the backlog is being sent
    const off = subscribe((e) => (queued ? queued.push(e) : void send(e)));
    stream.onAbort(() => { off(); });

    const replay = Math.min(Number(c.req.query("replay") ?? 50), 200);
    const sent = new Set<string>();
    if (live && replay > 0) {
      const backlog = await recentEvents(userId, { limit: replay, afterId: c.req.header("last-event-id") }).catch(() => []);
      for (const e of backlog) sent.add(e._id), await send(e);
    }
    for (const e of queued) if (!sent.has(e._id)) await send(e);
    queued = null;

    while (!stream.aborted) {
      await stream.writeSSE({ event: "ping", data: "" });
      await stream.sleep(15_000);
    }
  }),
);

core.get("/profile", (c) => c.json({ todo: "A: spend by category/month, recurring merchants, totals" }));
core.get("/stats", async (c) => c.json(live ? await getStats(userId) : fx.stats));

core.get("/mandates", async (c) => c.json(live ? await listMandates(userId) : fx.mandates));
core.post("/mandates", (c) => c.json({ todo: "A: create mandate" }, 501));
core.post("/mandates/:id/revoke", async (c) => {
  needDb();
  return c.json(await revokeMandate(c.req.param("id")));
});

// Each approval includes `product`, `offer`, `mandate` (when present) so cards can render without extra calls.
core.get("/approvals", async (c) => {
  const q = c.req.query("status");
  const status = q ? Approval.shape.status.parse(q) : undefined;
  return c.json(live ? await listApprovals(userId, status) : [fx.approval].filter((a) => !status || a.status === status));
});
// → { approval, order? } — `order` present when an approved purchase went through.
core.post("/approvals/:id", async (c) => {
  needDb();
  return c.json(await resolveApproval(c.req.param("id"), ApprovalDecision.parse(await c.req.json())));
});

core.post("/webhooks/photon", (c) => c.json({ todo: "A: inbound iMessage → orchestrator" }, 501));

core.post("/admin/price-drop", async (c) => {
  needDb();
  const { productId, newPriceCents } = AdminPriceDrop.parse(await c.req.json());
  return c.json(await priceDrop(userId, productId, newPriceCents));
});
core.post("/admin/advance-time", async (c) => c.json({ todo: "A", ...AdminAdvanceTime.parse(await c.req.json()) }, 501));
core.post("/admin/reset", async (c) => {
  needDb();
  return c.json({ ok: true, counts: await resetDemo() });
});
