// Owner: A. The one way to record something for the Agent Feed. Insert → change stream → SSE.
import { collections, newId } from "@alfred/shared/db";
import type { AgentEvent } from "@alfred/shared";

export async function emit(e: Omit<AgentEvent, "_id" | "ts">): Promise<AgentEvent> {
  const doc: AgentEvent = { ...e, _id: newId("evt"), ts: new Date() };
  const c = await collections();
  await c.agentEvents.insertOne(doc);
  return doc;
}
