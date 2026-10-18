// Owner: B. Agent routes (DESIGN.md §8.3). Stubs return fixtures until the orchestrator is live.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as fx from "@alfred/shared/fixtures";
import { ChatRequest } from "@alfred/shared";
import { getVerdict } from "../agents/data";

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

agents.get("/verdicts/:id", async (c) => {
  const v = await getVerdict(c.req.param("id"));
  return v ? c.json(v) : c.json({ error: "verdict not found" }, 404);
});
agents.get("/wishlist", (c) => c.json([]));
agents.post("/wishlist", (c) => c.json({ todo: "B: create watch" }, 501));
agents.get("/rewards", (c) => c.json([]));
agents.post("/rewards/:programId/enroll", (c) => c.json({ todo: "B: simulated enroll" }, 501));
agents.get("/timekeeper", (c) => c.json(fx.timekeeperVerdict));
