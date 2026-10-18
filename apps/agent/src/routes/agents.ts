// Owner: B. Agent routes (DESIGN.md §8.3). Stubs return fixtures until the orchestrator is live.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as fx from "@alfred/shared/fixtures";
import { ChatRequest } from "@alfred/shared";

export const agents = new Hono();

agents.post("/chat", async (c) => {
  ChatRequest.parse(await c.req.json());
  return streamSSE(c, async (stream) => {
    for (const delta of ["Let me check your ", "café spend… ", fx.verdict.headline]) {
      await stream.writeSSE({ data: JSON.stringify({ delta }) });
      await stream.sleep(150);
    }
    await stream.writeSSE({ data: JSON.stringify({ done: true, verdictId: fx.verdict._id }) });
  });
});

agents.get("/verdicts/:id", (c) => c.json(c.req.param("id") === fx.timekeeperVerdict._id ? fx.timekeeperVerdict : fx.verdict));
agents.get("/wishlist", (c) => c.json([]));
agents.post("/wishlist", (c) => c.json({ todo: "B: create watch" }, 501));
agents.get("/rewards", (c) => c.json([]));
agents.post("/rewards/:programId/enroll", (c) => c.json({ todo: "B: simulated enroll" }, 501));
agents.get("/timekeeper", (c) => c.json(fx.timekeeperVerdict));
