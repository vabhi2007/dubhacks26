// Owner: A. Watches agent_events (→ SSE) and approvals (pending → Messenger). Requires MONGODB_URI.
// Every teammate's agent watches the same db, so side effects here run once per running agent — keep MESSENGER=console
// everywhere except the one demo machine.
import { collections, type ChangeStreamInsertDocument, type Collection, type Document } from "@alfred/shared/db";
import type { Approval } from "@alfred/shared";
import { broadcast } from "./sse";
import { pickCard, rewardFor } from "./cards";
import { usd } from "./util";
import { messenger } from "../messenger";

/**
 * Inserts only. Reopens after errors (with backoff), resuming from the latest token — kept fresh even on quiet streams via
 * `resumeTokenChanged`. The token is dropped only if reopening with it fails before the stream initializes.
 */
function watchInserts<T extends Document>(name: string, coll: Collection<T>, match: Document, onInsert: (doc: T) => unknown) {
  let resumeAfter: unknown;
  let failures = 0;
  const open = () => {
    const cs = coll.watch<T, ChangeStreamInsertDocument<T>>([{ $match: { operationType: "insert", ...match } }], resumeAfter ? { resumeAfter } : {});
    let initialized = false;
    cs.on("init", () => {
      initialized = true;
      failures = 0;
    });
    cs.on("resumeTokenChanged", (token) => (resumeAfter = token));
    cs.on("change", (ch) => {
      resumeAfter = ch._id;
      Promise.resolve(onInsert(ch.fullDocument as T)).catch((e) => console.error(`[${name}] handler failed:`, (e as Error).message));
    });
    cs.on("error", (e) => {
      failures++;
      if (!initialized && failures > 1) resumeAfter = undefined; // can't resume from this token — start fresh
      const delay = Math.min(30_000, 1000 * 2 ** failures);
      console.error(`[${name}] change stream error: ${e.message} — reopening in ${delay / 1000}s`);
      cs.close().catch(() => {});
      setTimeout(open, delay);
    });
  };
  open();
}

async function approvalText(a: Approval) {
  const c = await collections();
  const [product, offer, mandate, cards] = await Promise.all([
    a.productId ? c.products.findOne({ _id: a.productId }, { projection: { embedding: 0 } }) : null,
    a.offerId ? c.offers.findOne({ _id: a.offerId }) : null,
    a.mandateId ? c.mandates.findOne({ _id: a.mandateId }) : null,
    c.cards.find({ userId: a.userId }).toArray(),
  ]);
  const card = product && cards.length ? pickCard(cards, product.category, mandate) : undefined;
  const reward = card && product ? rewardFor(card, product.category, a.amountCents) : 0;
  const last4 = mandate?.card.last4 ?? card?.last4;
  const what = product ? `${product.title}${offer ? ` at ${offer.seller}` : ""}` : a.kind === "enroll" ? "Rewards enrollment" : "Purchase";
  return {
    text: `${what}: ${usd(a.amountCents)}. ${a.kind === "enroll" ? "Enroll" : `Buy on your Visa${last4 ? ` ••${last4}` : ""}`}${reward ? ` (+${usd(reward)} back)` : ""}? Reply YES ${a.shortCode} or NO ${a.shortCode}`,
    imageUrl: product?.imageUrl,
  };
}

export async function startChangeStreams() {
  const c = await collections();
  watchInserts("agent_events", c.agentEvents, {}, broadcast);
  watchInserts("approvals", c.approvals, { "fullDocument.status": "pending", "fullDocument.channel": { $ne: "web" } }, async (a) =>
    messenger.send(a.userId, await approvalText(a)),
  );
}
