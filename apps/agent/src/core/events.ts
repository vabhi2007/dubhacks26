// Owner: A. The one way to record something for the Agent Feed. Insert → change stream → SSE.
// Pass `session` to commit the event atomically with other writes (e.g. purchase()).
import { collections, newId, type ClientSession } from "@alfred/shared/db";
import type { AgentEvent } from "@alfred/shared";

export async function emit(e: Omit<AgentEvent, "_id" | "ts">, opts: { session?: ClientSession } = {}): Promise<AgentEvent> {
  const doc: AgentEvent = { ...e, _id: newId("evt"), ts: new Date() };
  const c = await collections();
  await c.agentEvents.insertOne(doc, { session: opts.session });
  return doc;
}

export async function recentEvents(userId: string, opts: { limit?: number; afterId?: string } = {}): Promise<AgentEvent[]> {
  const c = await collections();
  const after = opts.afterId ? await c.agentEvents.findOne({ _id: opts.afterId }) : null;
  const docs = await c.agentEvents
    .find({ userId, ...(after && { ts: { $gt: after.ts } }) })
    .sort({ ts: -1 })
    .limit(opts.limit ?? 50)
    .toArray();
  return docs.reverse();
}
