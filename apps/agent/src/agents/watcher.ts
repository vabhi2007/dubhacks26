// Owner: B. Watcher (F5): wishlist target prices → on a price drop, buy through the mandate or ask the human.
// Money only moves via A's purchase() (→ authorize()); the confirm threshold and mandate checks live there, not here.
// Every teammate's agent sees the same change stream, so each trigger is claimed atomically (watching → triggered).
import { HTTPException } from "hono/http-exception";
import { collections, newId } from "@alfred/shared/db";
import type { AgentEvent, Mandate, Offer, Product, Surface, WishlistItem } from "@alfred/shared";
import { emit, purchase, requestApproval, subscribe } from "../core";
import { bestOffer, getOffers, getProduct, getProducts } from "./data";
import { usd } from "./format";

export type WatchView = WishlistItem & { product?: Product; bestOffer?: Offer };

/** Internal fields beyond the frozen WishlistItem contract: the approval a triggered watch is waiting on. */
type WatchDoc = WishlistItem & { approvalId?: string };

/** Create (or retarget) the user's watch on a product. If it's already at/below target, fires immediately. */
export async function createWatch(a: { userId: string; productId: string; targetPriceCents: number; surface?: Surface }): Promise<WishlistItem> {
  const product = await getProduct(a.productId);
  if (!product) throw new HTTPException(404, { message: `unknown product ${a.productId}` });
  const c = await collections();
  const mandate = await pickMandate(a.userId, product);

  const existing = await c.wishlist.findOne({ userId: a.userId, productId: a.productId, status: { $in: ["watching", "triggered"] } });
  if (existing?.status === "triggered") {
    // An approval for this watch is already out. Firing again (new key, maybe a new price) could create a second one
    // and, with two YESes, two orders — so only move the target; settle()/revive() decide what happens next.
    await c.wishlist.updateOne({ _id: existing._id, status: "triggered" }, { $set: { targetPriceCents: a.targetPriceCents } });
    await emit({
      userId: a.userId, agent: "watcher", surface: a.surface ?? "web", type: "watch_created",
      summary: `Updated your ${product.title} watch to ${usd(a.targetPriceCents)} — still waiting on your approval`,
      refs: { productId: a.productId, ...(existing.mandateId && { mandateId: existing.mandateId }) },
    });
    return (await c.wishlist.findOne({ _id: existing._id })) ?? existing;
  }
  const item: WishlistItem = {
    _id: existing?._id ?? newId("wsh"),
    userId: a.userId,
    productId: a.productId,
    targetPriceCents: a.targetPriceCents,
    ...(mandate && { mandateId: mandate._id }),
    status: "watching",
  };
  await c.wishlist.replaceOne({ _id: item._id }, item, { upsert: true });
  await emit({
    userId: a.userId,
    agent: "watcher",
    surface: a.surface ?? "web",
    type: "watch_created",
    summary: `Watching ${product.title} under ${usd(a.targetPriceCents)}${mandate ? ` · ${mandate.label} mandate` : " · will ask before buying"}`,
    refs: { productId: a.productId, ...(mandate && { mandateId: mandate._id }) },
  });

  try {
    await checkWatches(a.userId, a.productId, `watch:${item._id}:created`);
  } catch (e) {
    // The watch is saved and announced; a failed first check shouldn't make POST /wishlist fail. The next drop retries.
    console.error(`[watcher] immediate check for ${item._id} failed:`, (e as Error).message);
  }
  return (await c.wishlist.findOne({ _id: item._id })) ?? item;
}

export async function listWatches(userId: string): Promise<WatchView[]> {
  const c = await collections();
  const items = await c.wishlist.find({ userId, status: { $ne: "cancelled" } }).toArray();
  const products = await getProducts([...new Set(items.map((i) => i.productId))]);
  const offers = new Map(await Promise.all(products.map(async (p) => [p._id, bestOffer(await getOffers(p._id))] as const)));
  return items.map((i) => ({ ...i, product: products.find((p) => p._id === i.productId), bestOffer: offers.get(i.productId) }));
}

/**
 * Fire every watch on this product whose target the current best price meets.
 * `trigger` makes purchase() idempotent across processes and retries (e.g. the price_drop event id).
 */
export async function checkWatches(userId: string, productId: string, trigger: string) {
  await revive(userId, productId);
  const best = bestOffer(await getOffers(productId));
  if (!best) return;
  const c = await collections();
  const due = await c.wishlist.find({ userId, productId, status: "watching", targetPriceCents: { $gte: best.priceCents } }).toArray();

  for (const w of due) {
    // Claim it: only one agent process (of the four teammates' running) acts on a given trigger.
    const claimed = await c.wishlist.findOneAndUpdate({ _id: w._id, status: "watching" }, { $set: { status: "triggered" } });
    if (!claimed) continue;
    try {
      if (w.mandateId) {
        const r = await purchase({
          userId, offerId: best._id, mandateId: w.mandateId, agent: "watcher", surface: "system",
          idempotencyKey: `watch:${w._id}:${trigger}`,
        });
        if (r.status === "purchased") await c.wishlist.updateOne({ _id: w._id }, { $set: { status: "bought" }, $unset: { approvalId: "" } });
        // needs_approval / declined: purchase() created the approval; stay triggered until it resolves (or goes stale).
        else await waitOn(w._id, r.approval._id);
      } else {
        // No mandate covers it: ask; approving mints a one-time mandate inside A's resolveApproval().
        const approval = await requestApproval({
          userId, amountCents: best.priceCents, productId, offerId: best._id, agent: "watcher", surface: "system",
          idempotencyKey: `watch:${w._id}:${trigger}`,
        });
        await waitOn(w._id, approval._id);
      }
    } catch (e) {
      // Release the claim so the next drop (or a retry) can fire it again.
      await c.wishlist.updateOne({ _id: w._id, status: "triggered" }, { $set: { status: "watching" }, $unset: { approvalId: "" } });
      throw e;
    }
  }
}

const waitOn = async (watchId: string, approvalId: string) =>
  (await collections()).wishlist.updateOne({ _id: watchId, status: "triggered" }, { $set: { approvalId } as Partial<WatchDoc> });

/**
 * Triggered watches whose approval stopped being pending without an approval_resolved event — expired past its TTL
 * (expireStale) or cancelled by revokeMandate — go back to watching so the next drop can fire them (#20).
 * Approved ones are left alone: their purchase event marks them bought.
 */
async function revive(userId: string, productId: string) {
  const c = await collections();
  const stuck = await c.wishlist.find<WatchDoc>({ userId, productId, status: "triggered" }).toArray();
  if (!stuck.length) return;
  const now = new Date();
  const live = (a: { status: string; expiresAt: Date } | null | undefined) => a && (a.status === "approved" || (a.status === "pending" && a.expiresAt > now));
  for (const w of stuck) {
    const waitingOn = w.approvalId
      ? await c.approvals.findOne({ _id: w.approvalId, userId })
      : // Watches triggered before approvalId existed: any open approval for this product counts.
        await c.approvals.findOne({ userId, productId, status: { $in: ["pending", "approved"] } }, { sort: { expiresAt: -1 } });
    if (live(waitingOn)) continue;
    await c.wishlist.updateOne({ _id: w._id, status: "triggered", approvalId: w.approvalId } as Partial<WatchDoc>, { $set: { status: "watching" }, $unset: { approvalId: "" } });
  }
}

/** Approval resolved for a triggered watch: approved → bought (on the purchase event); denied/expired → back to watching. */
async function settle(e: AgentEvent) {
  const productId = e.refs.productId;
  if (!productId) return;
  const c = await collections();
  if (e.type === "purchase") {
    await c.wishlist.updateMany({ userId: e.userId, productId, status: "triggered" }, { $set: { status: "bought" }, $unset: { approvalId: "" } });
    return;
  }
  // approval_resolved: only act on denials (approvals are followed by a purchase event).
  const approval = e.refs.approvalId ? await c.approvals.findOne({ _id: e.refs.approvalId }) : null;
  if (approval && approval.status !== "approved")
    await c.wishlist.updateMany(
      { userId: e.userId, productId, status: "triggered", $or: [{ approvalId: approval._id }, { approvalId: { $exists: false } }] } as object,
      { $set: { status: "watching" }, $unset: { approvalId: "" } },
    );
}

let started = false;
/** Listen on the shared event stream (fed by A's agent_events change stream). Idempotent. */
export function startWatcher() {
  if (started) return;
  started = true;
  subscribe((e) => {
    const run =
      e.type === "price_drop" && e.refs.productId ? checkWatches(e.userId, e.refs.productId, `price_drop:${e._id}`)
      : e.type === "purchase" || e.type === "approval_resolved" ? settle(e)
      : undefined;
    run?.catch((err) => console.error(`[watcher] ${e.type} ${e._id} failed:`, (err as Error).message));
  });
}

/** The Watcher's own active, unexpired mandate covering this category, most headroom first.
 *  Mandates are agent-scoped (core/mandates.ts): the Watcher can't spend one issued to another agent. */
async function pickMandate(userId: string, product: Product): Promise<Mandate | undefined> {
  const c = await collections();
  const ms = await c.mandates
    .find({ userId, agent: "watcher", status: "active", expiresAt: { $gt: new Date() }, categories: product.category })
    .toArray();
  return ms.sort((a, b) => b.capCents - b.spentCents - (a.capCents - a.spentCents))[0];
}
