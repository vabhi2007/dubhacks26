// Owner: A. Platform routes (DESIGN.md §8.3). Without MONGODB_URI everything answers from fixtures (writes echo), so
// web/extension can run the whole approve/deny/revoke loop with no db. Bodies are validated before anything else.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import * as fx from "@alfred/shared/fixtures";
import { AdminAdvanceTime, AdminPriceDrop, Approval, ApprovalDecision, type AgentEvent } from "@alfred/shared";
import { env } from "../env";
import { priceDrop, resetDemo } from "../core/admin";
import { listApprovals, type ApprovalView } from "../core/approvals";
import { emit, recentEvents } from "../core/events";
import { listMandates, revokeMandate } from "../core/mandates";
import { resolveApproval } from "../core/purchase";
import { subscribe } from "../core/sse";
import { breakEvenFrom, getProductDetail, rankOffers } from "../core/products";
import { getStats } from "../core/stats";
import { lastApprovalAsked, messenger } from "../messenger";
import { routeInbound } from "../messenger/inbound";
import { z } from "zod";

export const core = new Hono();
const userId = env.DEMO_USER_ID;
const live = Boolean(env.MONGODB_URI);
// /admin/reset wipes the db the whole team shares — only enabled where ALLOW_RESET=1 (Workstream A / the demo machine).
const resetAllowed = process.env.ALLOW_RESET === "1";

const MAX_PENDING_WRITES = 500; // a client that stalls without disconnecting gets cut off instead of buffering forever

// SSE of the demo user's AgentEvents. On connect, replays recent events oldest-first (`?replay=N`, default 50, 0 = none;
// or the events after the Last-Event-ID header on reconnect), then streams live. Each message has `id: <event _id>` —
// clients must dedupe by it (replay can overlap live).
core.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    let chain = Promise.resolve();
    let pending = 0;
    const send = (e: AgentEvent) => {
      if (++pending > MAX_PENDING_WRITES) return void stream.abort();
      chain = chain.then(() => stream.writeSSE({ id: e._id, event: "agent_event", data: JSON.stringify(e) })).finally(() => pending--);
      return chain;
    };
    let queued: AgentEvent[] | null = []; // live events that arrive while the backlog is being sent
    const off = subscribe((e) => {
      if (e.userId !== userId) return;
      if (queued) queued.push(e);
      else void send(e);
    });
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

// Product page: { product, offers (ranked), priceHistory (90d, new/exact sellers), latestVerdict, watch, breakEven }.
core.get("/products/:id", async (c) => {
  const id = c.req.param("id");
  if (live) return c.json(await getProductDetail(id, userId));
  if (id !== fx.product._id) throw new HTTPException(404, { message: `product ${id} not found` });
  return c.json({ product: fx.product, offers: rankOffers(fx.offers), priceHistory: [], latestVerdict: fx.verdict, watch: null, breakEven: breakEvenFrom(fx.verdict) });
});

core.get("/mandates", async (c) => c.json(live ? await listMandates(userId) : fx.mandates));
core.post("/mandates", (c) => c.json({ todo: "A: create mandate" }, 501));
core.post("/mandates/:id/revoke", async (c) => {
  const id = c.req.param("id");
  if (live) return c.json(await revokeMandate(id, userId));
  const m = fx.mandates.find((x) => x._id === id);
  if (!m) throw new HTTPException(404, { message: `mandate ${id} not found` });
  return c.json({ ...m, status: "revoked" });
});

// Each approval also carries `product`, `offer`, `mandate`, `cardLast4`, `rewardCents` (ApprovalView) — same shape on fixtures.
const fixtureApproval: ApprovalView = { ...fx.approval, agent: "watcher", product: fx.product, offer: fx.offers[0], mandate: fx.mandates[0], cardLast4: "4821", rewardCents: 4_47 };
core.get("/approvals", async (c) => {
  const q = c.req.query("status");
  const status = q ? Approval.shape.status.parse(q) : undefined;
  return c.json(live ? await listApprovals(userId, status) : [fixtureApproval].filter((a) => !status || a.status === status));
});
// → { approval, order? } — `order` present when an approved purchase went through.
core.post("/approvals/:id", async (c) => {
  const decision = ApprovalDecision.parse(await c.req.json());
  if (live) return c.json(await resolveApproval(c.req.param("id"), decision, userId));
  if (c.req.param("id") !== fx.approval._id) throw new HTTPException(404, { message: `approval ${c.req.param("id")} not found` });
  const approved = decision.decision === "approve";
  const approval = { ...fx.approval, status: approved ? "approved" : "denied", resolvedAt: new Date(), channel: decision.channel } as const;
  const order = { _id: "ord_fixture", userId, productId: fx.product._id, offerId: "ofr_1", mandateId: "mnd_kitchen", cardId: "crd_sig", amountCents: fx.approval.amountCents, rewardEarnedCents: 4_47, ts: new Date() };
  return c.json(approved ? { approval, order } : { approval });
});

core.post("/webhooks/photon", (c) => c.json({ todo: "A: inbound iMessage → orchestrator" }, 501));

core.post("/admin/price-drop", async (c) => {
  const { productId, newPriceCents } = AdminPriceDrop.parse(await c.req.json());
  if (live) return c.json(await priceDrop(userId, productId, newPriceCents));
  const offer = fx.offers.find((o) => o.productId === productId && o.condition === "new");
  if (!offer) throw new HTTPException(404, { message: `no new US offer for ${productId}` });
  return c.json({ offer: { ...offer, priceCents: newPriceCents }, previousPriceCents: offer.priceCents });
});
// Simulate an inbound iMessage from the demo user (works with MESSENGER=console or photon): runs the same handler as a
// real text and returns the replies. { text } for "YES A7" / chat, { image } (base64 or data URL) for a photo.
const AdminInbound = z.object({ text: z.string().default(""), image: z.string().min(1).optional() }).refine((b) => b.text.trim() || b.image, "text or image required");
core.post("/admin/inbound", async (c) => {
  const { text, image } = AdminInbound.parse(await c.req.json());
  if (!live) throw new HTTPException(503, { message: "MONGODB_URI not set" });
  const replies: string[] = [];
  const msg = { userId, text, imageUrls: image ? [image] : [], channel: "imessage" as const };
  await routeInbound(msg, async (m) => {
    replies.push(m.text);
    await messenger.send(userId, m);
  }, lastApprovalAsked(userId));
  return c.json({ replies });
});
core.post("/admin/advance-time", async (c) => c.json({ todo: "A", ...AdminAdvanceTime.parse(await c.req.json()) }, 501));
core.post("/admin/reset", async (c) => {
  if (!resetAllowed) throw new HTTPException(403, { message: "reset is disabled here — it wipes the shared db. Set ALLOW_RESET=1 only on Workstream A's / the demo machine." });
  if (!live) throw new HTTPException(503, { message: "MONGODB_URI not set — nothing to reset" });
  const counts = await resetDemo();
  // Change streams only see inserts: this tells connected surfaces to refetch.
  await emit({ userId, agent: "orchestrator", surface: "system", type: "message", summary: "Demo data reset", refs: {} });
  return c.json({ ok: true, counts });
});
