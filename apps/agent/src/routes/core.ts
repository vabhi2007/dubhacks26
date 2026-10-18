// Owner: A. Platform routes (DESIGN.md §8.3). Stubs return fixtures until wired to Mongo.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as fx from "@alfred/shared/fixtures";
import { AdminAdvanceTime, AdminPriceDrop, ApprovalDecision } from "@alfred/shared";
import { subscribe } from "../core/sse";

export const core = new Hono();

core.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const off = subscribe((e) => void stream.writeSSE({ event: "agent_event", data: JSON.stringify(e) }));
    stream.onAbort(() => { off(); });
    while (!stream.aborted) {
      await stream.writeSSE({ event: "ping", data: "" });
      await stream.sleep(15_000);
    }
  }),
);

core.get("/profile", (c) => c.json({ todo: "A: spend by category/month, recurring merchants, totals" }));
core.get("/stats", (c) => c.json(fx.stats));
core.get("/mandates", (c) => c.json(fx.mandates));
core.post("/mandates", (c) => c.json({ todo: "A: create mandate" }, 501));
core.post("/mandates/:id/revoke", (c) => c.json({ todo: "A: revoke", id: c.req.param("id") }, 501));
core.get("/approvals", (c) => c.json([fx.approval]));
core.post("/approvals/:id", async (c) => {
  const body = ApprovalDecision.parse(await c.req.json());
  return c.json({ todo: "A: resolve approval → purchase()", id: c.req.param("id"), ...body }, 501);
});

core.post("/webhooks/photon", (c) => c.json({ todo: "A: inbound iMessage → orchestrator" }, 501));

core.post("/admin/price-drop", async (c) => c.json({ todo: "A", ...AdminPriceDrop.parse(await c.req.json()) }, 501));
core.post("/admin/advance-time", async (c) => c.json({ todo: "A", ...AdminAdvanceTime.parse(await c.req.json()) }, 501));
core.post("/admin/reset", (c) => c.json({ todo: "A: reseed demo persona" }, 501));
