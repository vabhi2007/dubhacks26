// Owner: B. Orchestrator (DESIGN.md §4): one conversational agent for web chat, the extension and iMessage.
// Tool Runner over the sub-agents. Guardrails live in the tools' code (A's purchase()/authorize()), never in this prompt:
// the model never chooses the user or an amount — userId comes from the request, prices from the offer.
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessageParam, BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { collections } from "@alfred/shared/db";
import { fmtUSD, type ConversationMessage, type Offer, type Product, type Surface } from "@alfred/shared";
import { emit, purchase, requestApproval } from "../core";
import { findOffers, rankOffers } from "../deal";
import { resolveProduct, vision } from "../vision";
import { env } from "../env";
import { anthropic } from "./client";
import { getOffers, getProduct, hasDb, searchProducts, spendByCategory } from "./data";
import { usd } from "./format";
import { createWatch, listWatches } from "./watcher";
import { worthIt } from "./worthIt";

export type UserMessage = {
  userId: string;
  text: string;
  surface: Surface;
  /** Photos (iMessage) or attachments (web): https:// or data: URLs. */
  imageUrls?: string[];
  /** Streamed reply text, as it's generated. */
  onDelta?: (text: string) => void;
};

export type AgentReply = { text: string; verdictId?: string };

const HISTORY_TURNS = 20;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const PREAMBLE_CHARS = 120; // tool-call preambles are shorter than this; past it, stream live

const SYSTEM = `You are Alfred, a shopping agent with scoped spending power over the user's money. You find products, judge honestly whether they're worth it, watch prices, and buy only within the user's rules.

How to work:
- Use tools for every fact: products, prices, spending, verdicts. Never invent a price, product or number.
- "Is X worth it / should I buy X": find the product (find_product, or snap_find for a photo), then worth_it. Lead with its verdict (Buy / Wait / Skip) and the single most useful reason.
- Offer to watch a price when the verdict is Wait; use create_watch with the target the user names, or the expected low price.
- buy only when the user clearly asks to buy a specific offer. The tool decides whether it can pay now or must ask the user to approve; report exactly what it returned. Never say something was bought unless the tool says "purchased".
- Don't narrate before calling tools; just call them.
- Be brief and concrete: 1–3 short sentences, money in whole dollars. Plain text only — no markdown, headers or bullet symbols (replies may go to iMessage).
- If you can't find something, say so and ask one short clarifying question.`;

/** Run one user turn through the orchestrator. Shared by /chat (web, extension) and A's iMessage handler. */
export async function handleUserMessage(msg: UserMessage): Promise<AgentReply> {
  const { userId, surface } = msg;
  const imageUrls = msg.imageUrls ?? [];
  const history = await loadHistory(userId);
  const turn = { verdictId: undefined as string | undefined, idem: `chat:${Date.now().toString(36)}` };

  let reply: AgentReply;
  try {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    reply = await runAgent(msg, history, tools({ userId, surface, imageUrls, turn }), turn);
  } catch (e) {
    console.warn("[orchestrator] Claude unavailable, using offline reply:", (e as Error).message);
    reply = await offlineReply(msg, turn);
    msg.onDelta?.(reply.text);
  }

  await saveTurn(userId, [
    { role: "user", text: msg.text, ts: new Date(), surface, ...(imageUrls.length && { attachments: imageUrls.map((url) => ({ kind: "image" as const, url: url.startsWith("data:") ? "data:(inline image)" : url })) }) },
    { role: "assistant", text: reply.text, ts: new Date(), surface },
  ]);
  if (hasDb())
    void emit({
      userId, agent: "orchestrator", surface, type: "message",
      summary: reply.text.length > 140 ? `${reply.text.slice(0, 137)}…` : reply.text,
      refs: reply.verdictId ? { verdictId: reply.verdictId } : {},
    }).catch((e) => console.warn("[orchestrator] emit failed:", (e as Error).message));
  return reply;
}

async function runAgent(msg: UserMessage, history: BetaMessageParam[], toolset: ReturnType<typeof tools>, turn: { verdictId?: string }): Promise<AgentReply> {
  const content: BetaContentBlockParam[] = [];
  (msg.imageUrls ?? []).forEach((url, i) => {
    if (url.startsWith("https://")) content.push({ type: "image", source: { type: "url", url } });
    content.push({ type: "text", text: `[Image ${i} attached — use snap_find with imageIndex ${i} to identify it]` });
  });
  content.push({ type: "text", text: msg.text || "(no text)" });

  const runner = anthropic.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    max_iterations: 8,
    stream: true,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: `${SYSTEM}\n\nSurface: ${msg.surface}. Today: ${new Date().toDateString()}.`,
    tools: toolset,
    messages: [...history, { role: "user", content }],
  });

  let text = "";
  let streamed = false;
  for await (const stream of runner) {
    // Text before a tool call is a working note ("let me look that up"), not the answer. Hold each iteration's text
    // until it's long enough to be a real answer (then stream live) or the iteration ends without calling a tool.
    let held = "";
    let live = false;
    const out = (d: string) => {
      msg.onDelta?.(!streamed && d ? d.trimStart() : d);
      streamed ||= Boolean(d);
    };
    stream.on("text", (d) => {
      if (live) return out(d);
      held += d;
      if (held.length > PREAMBLE_CHARS) {
        live = true;
        out(streamed ? `\n\n${held}` : held);
      }
    });
    const m = await stream.finalMessage();
    if (m.stop_reason === "refusal") throw new Error("model declined");
    if (!live && held.trim() && m.stop_reason !== "tool_use") out(streamed ? `\n\n${held}` : held);
    // The reply is the last iteration that said something.
    const t = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (t && m.stop_reason !== "tool_use") text = t;
  }
  return { text: text || "Done.", verdictId: turn.verdictId };
}

// ---------- tools ----------

type Ctx = { userId: string; surface: Surface; imageUrls: string[]; turn: { verdictId?: string; idem: string } };

const json = (x: unknown) => JSON.stringify(x);
const productView = (p: Product) => ({ productId: p._id, title: p.title, brand: p.brand, category: p.category });
const offerView = (o: Offer) => ({ offerId: o._id, seller: o.seller, price: usd(o.priceCents), condition: o.condition, region: o.region, matched: o.matched });

function tools(ctx: Ctx) {
  const { userId, surface } = ctx;
  return [
    betaZodTool({
      name: "find_product",
      description: "Search the product catalog by name, brand or model (e.g. 'breville bambino', 'iphone 17'). Returns up to 5 matches with productId.",
      inputSchema: z.object({ query: z.string().min(1) }),
      run: async ({ query }) => {
        const ps = await searchProducts(query);
        return ps.length ? json(ps.map(productView)) : `No catalog match for "${query}". Try fewer or different words.`;
      },
    }),
    betaZodTool({
      name: "snap_find",
      description: "Identify the product in an attached image and return it with its best offers.",
      inputSchema: z.object({ imageIndex: z.number().int().min(0) }),
      run: async ({ imageIndex }) => {
        const url = ctx.imageUrls[imageIndex];
        if (!url) return `No image at index ${imageIndex}.`;
        const img = await loadImage(url);
        const product = await resolveProduct(await vision.detect(img));
        const offers = await offersFor(product);
        void emit({ userId, agent: "vision", surface, type: "snap", summary: `Identified ${product.title} from your photo`, refs: { productId: product._id } }).catch(() => {});
        return json({ product: productView(product), offers: offers.slice(0, 5).map(offerView) });
      },
    }),
    betaZodTool({
      name: "deal_search",
      description: "Current offers for a product (best new US offer first; used/refurb labeled).",
      inputSchema: z.object({ productId: z.string() }),
      run: async ({ productId }) => {
        const p = await getProduct(productId);
        if (!p) return `Unknown productId ${productId}.`;
        const offers = await offersFor(p);
        return offers.length ? json(offers.slice(0, 6).map(offerView)) : `No offers found for ${p.title}.`;
      },
    }),
    betaZodTool({
      name: "worth_it",
      description: "Buy / Wait / Skip verdict for a product against the user's own spending, budget and price history. Shown to the user as a Verdict Card.",
      inputSchema: z.object({ productId: z.string() }),
      run: async ({ productId }) => {
        const p = await getProduct(productId);
        if (!p) return `Unknown productId ${productId}.`;
        const v = await worthIt({ userId, productId, product: p, offers: await offersFor(p), surface });
        ctx.turn.verdictId = v._id;
        return json({ verdictId: v._id, verdict: v.kind, headline: v.headline, reasons: v.reasons, bestOfferId: v.math.bestOfferId, price: usd(v.math.priceCents), expectedDrop: usd(v.math.expectedDropCents ?? 0) });
      },
    }),
    betaZodTool({
      name: "create_watch",
      description: "Watch a product's price. When the best price reaches the target, Alfred buys within the user's mandate or asks them to approve.",
      inputSchema: z.object({ productId: z.string(), targetPriceDollars: z.number().positive() }),
      run: async ({ productId, targetPriceDollars }) => {
        const w = await createWatch({ userId, productId, targetPriceCents: Math.round(targetPriceDollars * 100), surface });
        return json({ watchId: w._id, status: w.status, target: usd(w.targetPriceCents), mandate: w.mandateId ?? "none — will ask before buying" });
      },
    }),
    betaZodTool({
      name: "list_watches",
      description: "The user's price watches with current best prices.",
      inputSchema: z.object({}),
      run: async () => {
        const ws = await listWatches(userId);
        return ws.length
          ? json(ws.map((w) => ({ product: w.product?.title ?? w.productId, target: usd(w.targetPriceCents), now: w.bestOffer ? usd(w.bestOffer.priceCents) : "unknown", status: w.status })))
          : "No watches yet.";
      },
    }),
    betaZodTool({
      name: "spending_profile",
      description: "The user's last-12-months spending by category with top merchants.",
      inputSchema: z.object({}),
      run: async () =>
        json((await spendByCategory(userId)).map((s) => ({ category: s.category, total: usd(s.totalCents), perMonth: usd(s.totalCents / 12), purchases: s.txCount, top: s.topMerchants.map((m) => m.name) }))),
    }),
    betaZodTool({
      name: "buy",
      description: "Buy a specific offer the user asked for. Pays now only within an orchestrator mandate and under the user's confirm threshold; otherwise sends the user an approval request (iMessage + dashboard).",
      inputSchema: z.object({ offerId: z.string() }),
      run: async ({ offerId }) => {
        if (!hasDb()) return "Buying needs the database, which isn't configured here.";
        const c = await collections();
        const offer = await c.offers.findOne({ _id: offerId });
        if (!offer) return `Unknown offerId ${offerId}.`;
        const product = await getProduct(offer.productId);
        const mandate = product
          ? await c.mandates.findOne({ userId, agent: "orchestrator", status: "active", expiresAt: { $gt: new Date() }, categories: product.category })
          : null;
        const idempotencyKey = `${ctx.turn.idem}:${offerId}`;
        if (!mandate) {
          const a = await requestApproval({ userId, amountCents: offer.priceCents, productId: offer.productId, offerId, agent: "orchestrator", surface, idempotencyKey });
          return json({ status: "needs_approval", amount: fmtUSD(a.amountCents), shortCode: a.shortCode, note: "Asked the user to approve (reply YES/NO or tap Approve)." });
        }
        const r = await purchase({ userId, offerId, mandateId: mandate._id, agent: "orchestrator", surface, idempotencyKey });
        if (r.status === "purchased") return json({ status: "purchased", amount: usd(r.order.amountCents), rewardEarned: usd(r.order.rewardEarnedCents), card: `••${r.mandate.card.last4}` });
        return json({ status: r.status, shortCode: r.approval.shortCode, ...(r.status === "declined" && { reason: r.reason }) });
      },
    }),
  ];
}

/** C's deal pipeline first; with PRICE_SOURCE=mock it only prices the hero product, so fall back to seeded offers. */
async function offersFor(p: Product): Promise<Offer[]> {
  const live = await findOffers(p);
  return rankOffers(live.length ? live : await getOffers(p._id));
}

/** Images only from data: URLs or https (iMessage attachments), size-capped. */
async function loadImage(url: string): Promise<Uint8Array> {
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  if (!url.startsWith("https://")) throw new Error("images must be https:// or data: URLs");
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error("image too large");
  return buf;
}

// ---------- conversation memory (one thread per user, shared across surfaces) ----------

const memory = new Map<string, ConversationMessage[]>(); // used when Mongo isn't configured
const convId = (userId: string) => `cnv_${userId}`;

async function loadHistory(userId: string): Promise<BetaMessageParam[]> {
  let msgs = memory.get(userId) ?? [];
  if (hasDb()) {
    try {
      const doc = await (await collections()).conversations.findOne({ _id: convId(userId) }, { projection: { messages: { $slice: -HISTORY_TURNS } } });
      msgs = doc?.messages ?? [];
    } catch (e) {
      console.warn("[orchestrator] history load failed:", (e as Error).message);
    }
  }
  // Text-only replay; tag the surface so the model knows where earlier turns happened.
  const out: BetaMessageParam[] = msgs.slice(-HISTORY_TURNS).map((m) => ({
    role: m.role,
    content: m.role === "user" ? `[${m.surface}] ${m.text}${m.attachments?.length ? " (sent a photo)" : ""}` : m.text,
  }));
  while (out[0]?.role === "assistant") out.shift(); // must start with a user turn
  return out;
}

async function saveTurn(userId: string, msgs: ConversationMessage[]) {
  memory.set(userId, [...(memory.get(userId) ?? []), ...msgs].slice(-HISTORY_TURNS));
  if (!hasDb()) return;
  try {
    await (await collections()).conversations.updateOne(
      { _id: convId(userId) },
      { $setOnInsert: { userId }, $push: { messages: { $each: msgs, $slice: -200 } } },
      { upsert: true },
    );
  } catch (e) {
    console.warn("[orchestrator] history save failed:", (e as Error).message);
  }
}

// ---------- no-key fallback ----------

/** Keeps the mock path useful without ANTHROPIC_API_KEY: catalog match → rule-based Worth-It. */
async function offlineReply(msg: UserMessage, turn: { verdictId?: string }): Promise<AgentReply> {
  const query = msg.text.replace(/\b(is|the|a|an|worth|it|should|i|buy|get|me|my|this|that|how|much)\b/gi, " ");
  const [p] = await searchProducts(query);
  if (!p) return { text: "I'm offline right now (no AI key). Ask about a product by name, like \"Is the Breville Bambino worth it?\"" };
  const v = await worthIt({ userId: msg.userId, productId: p._id, product: p, offers: await offersFor(p), surface: msg.surface });
  turn.verdictId = v._id;
  return { text: `${p.title}: ${v.headline}`, verdictId: v._id };
}
