// Owner: B. Agent routes (DESIGN.md §8.3).
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { ChatRequest } from "@alfred/shared";
import type { Product, Verdict } from "@alfred/shared";
import { z } from "zod";
import { Cents } from "@alfred/shared";
import { getProduct, getProducts, getVerdict, hasDb, listVerdicts } from "../agents/data";
import { createWatch, listWatches, startWatcher } from "../agents/watcher";
import { handleUserMessage, MAX_IMAGE_BYTES } from "../agents/orchestrator";
import { timekeeper } from "../agents/timekeeper";
import { enroll, rewardsScan } from "../agents/rewards";
import { env } from "../env";

export const agents = new Hono();

if (hasDb()) startWatcher();

// No shared schema exists for this body yet (DESIGN.md §8.3 only names the fields).
const CreateWatch = z.object({ productId: z.string(), targetPriceCents: Cents.positive(), surface: z.enum(["web", "extension", "imessage", "voice"]).optional() });

// SSE: {delta}… then {done, verdictId?} (or {error} then {done}).
// Attachments can be data URLs; base64 is ~4/3 the image size, so leave room for one max-size image.
const chatBodyLimit = bodyLimit({ maxSize: Math.ceil(MAX_IMAGE_BYTES * 1.4), onError: (c) => c.json({ error: "message too large (images up to 15 MB)" }, 413) });

agents.post("/chat", chatBodyLimit, async (c) => {
  const req = ChatRequest.parse(await c.req.json());
  return streamSSE(c, async (stream) => {
    // Deltas arrive from SDK callbacks; chain the writes so they stay in order.
    let writes = Promise.resolve();
    const send = (data: object) => (writes = writes.then(() => stream.writeSSE({ data: JSON.stringify(data) })));
    try {
      const reply = await handleUserMessage({
        userId: env.DEMO_USER_ID,
        text: req.text,
        surface: req.surface,
        imageUrls: req.attachments?.map((a) => a.url),
        onDelta: (delta) => void send({ delta }),
      });
      await send({ done: true, ...(reply.verdictId && { verdictId: reply.verdictId }) });
    } catch (e) {
      console.error("[chat] failed:", (e as Error).message);
      await send({ error: "Something went wrong — try again." });
      await send({ done: true });
    }
  });
});

// Newest first (Home shows ?limit=1). Out-of-range or non-numeric limits are clamped rather than rejected.
const VerdictList = z.object({ limit: z.coerce.number().int().catch(10).transform((n) => Math.min(50, Math.max(1, n))) });
// Attach display product info (title/imageUrl) so surfaces can label a verdict without a product route (#57).
const withProduct = (v: Verdict, p?: Product) => ({ ...v, product: p ? { title: p.title, imageUrl: p.imageUrl } : undefined });

agents.get("/verdicts", async (c) => {
  const { limit } = VerdictList.parse({ limit: c.req.query("limit") ?? 10 });
  const vs = await listVerdicts(env.DEMO_USER_ID, limit);
  const byId = new Map((await getProducts([...new Set(vs.map((v) => v.productId))])).map((p) => [p._id, p]));
  return c.json(vs.map((v) => withProduct(v, byId.get(v.productId))));
});

agents.get("/verdicts/:id", async (c) => {
  const v = await getVerdict(c.req.param("id"));
  return v ? c.json(withProduct(v, await getProduct(v.productId))) : c.json({ error: "verdict not found" }, 404);
});
agents.get("/wishlist", async (c) => (hasDb() ? c.json(await listWatches(env.DEMO_USER_ID)) : c.json([])));
agents.post("/wishlist", async (c) => {
  const body = CreateWatch.parse(await c.req.json());
  if (!hasDb()) return c.json({ error: "watches need MONGODB_URI" }, 503);
  return c.json(await createWatch({ userId: env.DEMO_USER_ID, ...body }), 201);
});
// Programs ranked by est. $/yr from the user's own merchant spend (+ Vector Search fit); enrolled ones included.
agents.get("/rewards", async (c) => c.json(await rewardsScan(env.DEMO_USER_ID)));
agents.post("/rewards/:programId/enroll", async (c) => c.json(await enroll(env.DEMO_USER_ID, c.req.param("programId"))));
// Upgrade now vs wait, for the user's phone. ?productId= picks the upgrade target; ?refresh=1 skips the 6h reuse.
agents.get("/timekeeper", async (c) =>
  c.json(await timekeeper({ userId: env.DEMO_USER_ID, productId: c.req.query("productId") || undefined, refresh: c.req.query("refresh") === "1" })),
);
