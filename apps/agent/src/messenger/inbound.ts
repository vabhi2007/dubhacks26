// Owner: A. What an inbound iMessage does (DESIGN.md F7). Same path for Photon and the simulator (POST /admin/inbound).
//   "YES A7" / "NO A7" → resolveApproval() → purchase(). Explicit codes always count.
//   A bare YES / NO counts only when the last message we sent this user was that approval request — B's orchestrator
//   asks yes/no questions too, and a "yes" to "want me to watch it?" must never approve an unrelated purchase.
//   Everything else (text, photos, "watch it", bare yes/no answering the agent) → B's POST /chat with image attachments,
//   so the orchestrator sees one conversation across surfaces and offers watches itself.
// Decisions run immediately; chat turns run in order per user (a slow chat turn never delays a YES A7).
import { collections } from "@alfred/shared/db";
import type { InboundMessage, OutboundMessage } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";
import { listApprovals } from "../core/approvals";
import { resolveApproval } from "../core/purchase";
import { usd } from "../core/util";
import { env } from "../env";

type Reply = (msg: OutboundMessage) => Promise<void>;

const AGENT = `http://127.0.0.1:${env.AGENT_PORT}`;
const DECISION = /^\s*(yes|y|yep|yeah|approve|no|n|nope|deny|skip)\b[\s,.!]*([a-z][2-9])?[\s.!]*$/i;

async function decide(userId: string, yes: boolean, approvalId: string, reply: Reply) {
  const pending = await listApprovals(userId, "pending");
  const a = pending.find((p) => p._id === approvalId);
  if (!a) return reply({ text: "That approval isn't pending anymore — it was already answered or expired." });
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

/** The approval a decision refers to: the explicit code, else the approval we just asked about (if any). */
async function decisionTarget(userId: string, code: string | undefined, lastAskedApprovalId: string | undefined) {
  if (!code) return lastAskedApprovalId ? { id: lastAskedApprovalId } : null;
  const a = (await listApprovals(userId, "pending")).find((p) => p.shortCode === code.toUpperCase());
  return a ? { id: a._id } : { missingCode: code.toUpperCase() };
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
      const d = JSON.parse(line.slice(5)) as { delta?: string; error?: string };
      if (d.delta) out += d.delta;
      if (d.error && !out) out = d.error;
    }
  }
  return reply({ text: out.trim() || "Hmm, I don't have an answer for that yet." });
}

const chatQueues = new Map<string, Promise<void>>();
function inOrder(userId: string, fn: () => Promise<void>) {
  const next = (chatQueues.get(userId) ?? Promise.resolve()).then(fn);
  chatQueues.set(userId, next.catch(() => {}));
  return next;
}

/** `lastAskedApprovalId`: the approval our most recent outbound message to this user asked about, if it was one. */
export async function routeInbound(msg: InboundMessage, reply: Reply, lastAskedApprovalId?: string) {
  const fail = async (e: unknown) => {
    console.error("[inbound] failed:", (e as Error).message);
    await reply({ text: "Sorry — something went wrong on my side. Try again in a moment?" });
  };
  try {
    const text = msg.text.trim();
    const decision = msg.imageUrls.length ? null : text.match(DECISION);
    if (decision) {
      const target = await decisionTarget(msg.userId, decision[2], lastAskedApprovalId);
      if (target && "missingCode" in target) return await reply({ text: `I don't have a pending approval ${target.missingCode} — it may have expired.` });
      if (target) return await decide(msg.userId, /^(y|approve)/i.test(decision[1]!), target.id, reply);
    }
    return await inOrder(msg.userId, () => chat(text, msg.imageUrls, reply).catch(fail));
  } catch (e) {
    await fail(e);
  }
}
