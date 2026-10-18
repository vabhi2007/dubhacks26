// Owner: A. What an inbound iMessage does (DESIGN.md F7). Same path for Photon and the simulator (POST /admin/inbound).
//   "YES A7" / "NO A7" (or a bare YES/NO when exactly one approval is pending) → resolveApproval() → purchase()
//   photo → C's POST /snap → verdict summary; "watch" → B's POST /wishlist for the last snapped product
//   anything else → B's POST /chat (SSE); the streamed text is the reply
// Other workstreams are reached only through their HTTP routes (DESIGN.md §8.3), so this keeps working as they evolve.
import { collections } from "@alfred/shared/db";
import type { InboundMessage, OutboundMessage, SnapResponse } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { listApprovals } from "../core/approvals";
import { resolveApproval } from "../core/purchase";
import { usd } from "../core/util";
import { env } from "../env";

type Reply = (msg: OutboundMessage) => Promise<void>;

const AGENT = `http://127.0.0.1:${env.AGENT_PORT}`;
const DECISION = /^\s*(yes|y|yep|yeah|approve|no|n|nope|deny|skip)\b[\s,.!]*([a-z][2-9])?[\s.!]*$/i;
const WATCH = /^\s*(watch( it)?|track( it)?|wait)\s*[.!]*$/i;
const lastSnap = new Map<string, { productId: string; title: string; targetPriceCents: number }>();

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${AGENT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

async function decide(userId: string, yes: boolean, code: string | undefined, reply: Reply) {
  const pending = await listApprovals(userId, "pending");
  const a = code ? pending.find((p) => p.shortCode === code.toUpperCase()) : pending.length === 1 ? pending[0] : undefined;
  if (!a) {
    if (code) return reply({ text: `I don't have a pending approval ${code.toUpperCase()} — it may have expired.` });
    if (!pending.length) return reply({ text: "Nothing is waiting on you right now." });
    return reply({ text: `Which one? ${pending.map((p) => `${p.shortCode}: ${usd(p.amountCents)} ${p.product?.title ?? ""}`.trim()).join(" · ")}` });
  }
  try {
    const { order } = await resolveApproval(a._id, { decision: yes ? "approve" : "deny", channel: "imessage" }, userId);
    if (!order) return reply({ text: `Got it — skipped ${a.product?.title ?? "it"}.` });
    const card = await (await collections()).cards.findOne({ _id: order.cardId });
    return reply({ text: `Done ✅ Bought ${a.product?.title ?? "it"} for ${usd(order.amountCents)}${card ? ` on Visa ••${card.last4}` : ""} (+${usd(order.rewardEarnedCents)} back).` });
  } catch (e) {
    if (e instanceof HTTPException && e.status < 500) return reply({ text: `Couldn't do that: ${e.message}.` });
    throw e;
  }
}

async function snap(userId: string, image: string, reply: Reply) {
  const { product, offers, verdict } = await call<SnapResponse>("/snap", { image, source: "imessage" });
  const best = offers.find((o) => o._id === verdict.math.bestOfferId) ?? offers[0];
  const target = verdict.math.priceCents - (verdict.math.expectedDropCents ?? Math.round(verdict.math.priceCents * 0.1));
  lastSnap.set(userId, { productId: product._id, title: product.title, targetPriceCents: target });
  const price = best ? `Best new price ${usd(best.priceCents)} at ${best.seller}. ` : "";
  const headline = /[.!?]$/.test(verdict.headline) ? verdict.headline : `${verdict.headline}.`;
  const next = verdict.kind === "skip" ? "" : ` Reply WATCH and I'll buy it if it drops to ${usd(target)}.`;
  return reply({ text: `${product.title}. ${price}${headline}${next}` });
}

async function watch(userId: string, reply: Reply) {
  const last = lastSnap.get(userId);
  if (!last) return reply({ text: "Send me a photo of what you want to watch first." });
  await call("/wishlist", { productId: last.productId, targetPriceCents: last.targetPriceCents, surface: "imessage" });
  return reply({ text: `Watching ${last.title}. I'll check with you before buying at ${usd(last.targetPriceCents)} or less.` });
}

async function chat(text: string, imageUrls: string[], reply: Reply) {
  const r = await fetch(`${AGENT}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, surface: "imessage", ...(imageUrls.length && { attachments: imageUrls.map((url) => ({ kind: "image", url })) }) }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok || !r.body) throw new Error(`/chat → ${r.status}`);
  let out = "";
  let buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = JSON.parse(line.slice(5)) as { delta?: string; done?: boolean };
      if (d.delta) out += d.delta;
    }
  }
  return reply({ text: out.trim() || "Hmm, I don't have an answer for that yet." });
}

export async function routeInbound(msg: InboundMessage, reply: Reply) {
  try {
    const text = msg.text.trim();
    const decision = text.match(DECISION);
    if (decision && !msg.imageUrls.length) return await decide(msg.userId, /^(y|approve)/i.test(decision[1]!), decision[2], reply);
    if (msg.imageUrls[0]) return await snap(msg.userId, msg.imageUrls[0], reply);
    if (WATCH.test(text)) return await watch(msg.userId, reply);
    if (text) return await chat(text, msg.imageUrls, reply);
  } catch (e) {
    console.error("[inbound] failed:", (e as Error).message);
    await reply({ text: "Sorry — something went wrong on my side. Try again in a moment?" });
  }
}
