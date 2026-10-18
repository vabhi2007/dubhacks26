// Owner: A. The one way to record something for the Agent Feed. Insert → change stream → SSE.
// Pass `session` to commit the event atomically with other writes (e.g. purchase()).
import { collections, newId, type ClientSession } from "@alfred/shared/db";
import type { AgentEvent } from "@alfred/shared";
import { OMIT_UNDEFINED } from "./util";

// Strictly increasing per process, so events emitted back to back (same transaction) keep their order and never tie.
let lastTs = 0;
const nextTs = () => new Date((lastTs = Math.max(Date.now(), lastTs + 1)));

export async function emit(e: Omit<AgentEvent, "_id" | "ts">, opts: { session?: ClientSession } = {}): Promise<AgentEvent> {
  const doc: AgentEvent = { ...e, _id: newId("evt"), ts: nextTs() };
  const c = await collections();
  await c.agentEvents.insertOne(doc, { session: opts.session, ...OMIT_UNDEFINED });
  return doc;
}

/**
 * Oldest-first. With `afterId`: the next `limit` events from that event's timestamp on (`$gte`, so events from another
 * process in the same millisecond aren't skipped — clients dedupe by _id). Unknown/absent id: the latest `limit` events.
 */
export async function recentEvents(userId: string, opts: { limit?: number; afterId?: string } = {}): Promise<AgentEvent[]> {
  const c = await collections();
  const limit = opts.limit ?? 50;
  const after = opts.afterId ? await c.agentEvents.findOne({ _id: opts.afterId, userId }) : null;
  if (after)
    return c.agentEvents.find({ userId, ts: { $gte: after.ts }, _id: { $ne: after._id } }).sort({ ts: 1 }).limit(limit).toArray();
  return (await c.agentEvents.find({ userId }).sort({ ts: -1 }).limit(limit).toArray()).reverse();
}
