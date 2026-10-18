// Owner: B. Orchestrator (DESIGN.md §4): one conversational agent for web chat, the extension and iMessage.
// Tool Runner over the sub-agents. Guardrails live in the tools' code (A's purchase()/authorize()), never in this prompt:
// the model never chooses the user or an amount — userId comes from the request, prices from the offer.
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessageParam, BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { collections, merchantIdFor } from "@alfred/shared/db";
import { fmtUSD, type ConversationMessage, type Offer, type Product, type Surface } from "@alfred/shared";
import { emit, purchase, requestApproval } from "../core";
import { findOffers, rankOffers } from "../deal";
import { resolveProduct, sniffMime, vision } from "../vision";
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

const HISTORY_MESSAGES = 40; // 20 turns (user + assistant)
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const RECENT_REFS = 8;
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
  const turn: Turn = { idem: `chat:${Date.now().toString(36)}`, actions: [], shown: "" };
  // Everything the user sees goes through say(), so the saved reply is exactly what was streamed.
  const say = (d: string) => {
    turn.shown += d;
    msg.onDelta?.(d);
  };

  let reply: AgentReply;
  try {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    reply = await runAgent(msg, history, tools({ userId, surface, imageUrls, turn }), turn, say);
  } catch (e) {
    console.warn("[orchestrator] turn failed:", (e as Error).message);
    if (turn.actions.length || turn.shown) {
      // Tools already acted (a purchase, an approval, a watch) or text already streamed: report what happened.
      // Falling back now would hide the action, repeat side effects, and garble the stream.
      const recap = turn.actions.length ? `Here's what I did before hitting a problem: ${turn.actions.join(" ")}` : "I hit a problem before finishing. Try again?";
      say(turn.shown ? `\n\n${recap}` : recap);
      reply = { text: turn.shown.trim(), verdictId: turn.verdictId };
    } else {
      reply = await offlineReply(msg, turn);
      say(reply.text);
    }
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

async function runAgent(msg: UserMessage, history: BetaMessageParam[], toolset: ReturnType<typeof tools>, turn: Turn, say: (d: string) => void): Promise<AgentReply> {
  // Images go to snap_find, which downloads them itself; not to Claude as URLs (attachment URLs may need auth or expire).
  const content: BetaContentBlockParam[] = (msg.imageUrls ?? []).map((_, i) => ({ type: "text", text: `[Image ${i} attached — use snap_find with imageIndex ${i} to identify it]` }));
  const refs = recentRefs.get(msg.userId);
  if (refs?.length) content.push({ type: "text", text: `[Recently discussed: ${refs.join("; ")}]` });
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

  for await (const stream of runner) {
    // Text before a tool call is a working note ("let me look that up"), not the answer. Hold each iteration's text
    // until it's long enough to be a real answer (then stream live) or the iteration ends without calling a tool.
    let held = "";
    let live = false;
    const out = (d: string) => say(turn.shown ? d : d.trimStart());
    const flush = () => out(turn.shown ? `\n\n${held}` : held);
    stream.on("text", (d) => {
      if (live) return out(d);
      held += d;
      if (held.length > PREAMBLE_CHARS) {
        live = true;
        flush();
      }
    });
    const m = await stream.finalMessage();
    if (m.stop_reason === "refusal") throw new Error("model declined");
    if (!live && held.trim() && m.stop_reason !== "tool_use") flush();
  }
  return { text: turn.shown.trim() || "Done.", verdictId: turn.verdictId };
}

// ---------- tools ----------

/** Per-turn state: side effects already taken (for an honest reply if the turn fails) and what's been shown. */
type Turn = { idem: string; verdictId?: string; actions: string[]; shown: string };
type Ctx = { userId: string; surface: Surface; imageUrls: string[]; turn: Turn };

// Tool results (ids) aren't replayed in history, so remember recently discussed items per user for "buy that one".
const recentRefs = new Map<string, string[]>();
function remember(userId: string, ref: string) {
  const xs = (recentRefs.get(userId) ?? []).filter((r) => r !== ref);
  recentRefs.set(userId, [...xs, ref].slice(-RECENT_REFS));
}

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
        ps.slice(0, 2).forEach((p) => remember(userId, `${p.title} = ${p._id}`));
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
        const { product, identified } = await resolveProduct(await vision.detect(img));
        if (!identified)
          return `Couldn't match the photo to a catalog product. It looks like: "${product.title}". Ask the user what it is, or try find_product with those words.`;
        const offers = await offersFor(product);
        remember(userId, `${product.title} = ${product._id}${offers[0] ? ` (best offer ${offers[0]._id})` : ""}`);
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
        if (offers[0]) remember(userId, `${p.title} = ${p._id} (best offer ${offers[0]._id})`);
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
        ctx.turn.actions.push(`${p.title}: ${({ buy: "Buy", wait: "Wait", skip: "Skip" })[v.kind]} — ${v.headline}`);
        if (v.math.bestOfferId) remember(userId, `${p.title} = ${p._id} (best offer ${v.math.bestOfferId})`);
        return json({ verdictId: v._id, verdict: v.kind, headline: v.headline, reasons: v.reasons, bestOfferId: v.math.bestOfferId, price: usd(v.math.priceCents), expectedDrop: usd(v.math.expectedDropCents ?? 0) });
      },
    }),
    betaZodTool({
      name: "create_watch",
      description: "Watch a product's price. When the best price reaches the target, Alfred buys within the user's mandate or asks them to approve.",
      inputSchema: z.object({ productId: z.string(), targetPriceDollars: z.number().positive() }),
      run: async ({ productId, targetPriceDollars }) => {
        const w = await createWatch({ userId, productId, targetPriceCents: Math.round(targetPriceDollars * 100), surface });
        ctx.turn.actions.push(`Watching ${(await getProduct(productId))?.title ?? productId} under ${usd(w.targetPriceCents)}${w.status === "bought" ? " (already bought: it was under target)" : ""}.`);
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
        const title = product?.title ?? offer.productId;
        const mandate = product ? await pickMandate(userId, product.category, merchantIdFor(offer.seller), offer.priceCents) : undefined;
        const idempotencyKey = `${ctx.turn.idem}:${offerId}`;
        if (!mandate) {
          const a = await requestApproval({ userId, amountCents: offer.priceCents, productId: offer.productId, offerId, agent: "orchestrator", surface, idempotencyKey });
          ctx.turn.actions.push(`Sent you an approval for ${title} at ${offer.seller} (${fmtUSD(a.amountCents)}, code ${a.shortCode}).`);
          return json({ status: "needs_approval", amount: fmtUSD(a.amountCents), shortCode: a.shortCode, note: "Asked the user to approve (reply YES/NO or tap Approve)." });
        }
        const r = await purchase({ userId, offerId, mandateId: mandate._id, agent: "orchestrator", surface, idempotencyKey });
        if (r.status === "purchased") {
          ctx.turn.actions.push(`Bought ${title} for ${usd(r.order.amountCents)} at ${offer.seller} on Visa ••${r.mandate.card.last4}.`);
          return json({ status: "purchased", amount: usd(r.order.amountCents), rewardEarned: usd(r.order.rewardEarnedCents), card: `••${r.mandate.card.last4}` });
        }
        ctx.turn.actions.push(`Sent you an approval for ${title} (${fmtUSD(r.approval.amountCents)}, code ${r.approval.shortCode}).`);
        return json({ status: r.status, shortCode: r.approval.shortCode, ...(r.status === "declined" && { reason: r.reason }) });
      },
    }),
  ];
}

/** The orchestrator's own active mandates covering this category or merchant (as authorize() matches);
 *  one with room for the amount, else the one with the most headroom (purchase() then asks for approval). */
async function pickMandate(userId: string, category: Product["category"], merchantId: string, amountCents: number) {
  const ms = await (await collections()).mandates
    .find({ userId, agent: "orchestrator", status: "active", expiresAt: { $gt: new Date() }, $or: [{ categories: category }, { merchants: merchantId }] })
    .toArray();
  const room = (m: (typeof ms)[number]) => m.capCents - m.spentCents;
  ms.sort((a, b) => room(b) - room(a));
  return ms.find((m) => room(m) >= amountCents) ?? ms[0];
}

/** C's deal pipeline first; with PRICE_SOURCE=mock it only prices the hero product, so fall back to seeded offers. */
async function offersFor(p: Product): Promise<Offer[]> {
  const live = await findOffers(p);
  return rankOffers(live.length ? live : await getOffers(p._id));
}

/** Images only from data: URLs or https (iMessage attachments): size-capped, no redirects, must sniff as an image. */
async function loadImage(url: string): Promise<Uint8Array> {
  let buf: Uint8Array;
  if (url.startsWith("data:")) {
    const b64 = url.slice(url.indexOf(",") + 1);
    if (b64.length * 0.75 > MAX_IMAGE_BYTES) throw new Error("image too large");
    buf = Buffer.from(b64, "base64");
  } else if (url.startsWith("https://")) {
    // redirect: "error" — a redirect could point the server at an internal address.
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("image too large");
    buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error("image too large");
  } else throw new Error("images must be https:// or data: URLs");
  if (!sniffMime(buf)) throw new Error("attachment isn't a PNG, JPEG, GIF or WebP image");
  return buf;
}

// ---------- conversation memory (one thread per user, shared across surfaces) ----------

const memory = new Map<string, ConversationMessage[]>(); // used when Mongo isn't configured
const convId = (userId: string) => `cnv_${userId}`;

async function loadHistory(userId: string): Promise<BetaMessageParam[]> {
  let msgs = memory.get(userId) ?? [];
  if (hasDb()) {
    try {
      const doc = await (await collections()).conversations.findOne({ _id: convId(userId) }, { projection: { messages: { $slice: -HISTORY_MESSAGES } } });
      msgs = doc?.messages ?? [];
    } catch (e) {
      console.warn("[orchestrator] history load failed:", (e as Error).message);
    }
  }
  // Text-only replay; tag the surface so the model knows where earlier turns happened.
  const out: BetaMessageParam[] = msgs.slice(-HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.role === "user" ? `[${m.surface}] ${m.text}${m.attachments?.length ? " (sent a photo)" : ""}` : m.text,
  }));
  while (out[0]?.role === "assistant") out.shift(); // must start with a user turn
  return out;
}

async function saveTurn(userId: string, msgs: ConversationMessage[]) {
  memory.set(userId, [...(memory.get(userId) ?? []), ...msgs].slice(-HISTORY_MESSAGES));
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

/** Keeps the mock path useful without ANTHROPIC_API_KEY: best catalog match → rule-based Worth-It. */
async function offlineReply(msg: UserMessage, turn: Turn): Promise<AgentReply> {
  const [p] = await searchProducts(msg.text, 1, { strict: true });
  if (!p) return { text: "I'm offline right now (no AI key). Ask about a product by name, like \"Is the Breville Bambino worth it?\"" };
  const v = await worthIt({ userId: msg.userId, productId: p._id, product: p, offers: await offersFor(p), surface: msg.surface });
  turn.verdictId = v._id;
  return { text: `${p.title}: ${v.headline}`, verdictId: v._id };
}
