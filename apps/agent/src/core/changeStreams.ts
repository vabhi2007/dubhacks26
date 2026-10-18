// Owner: A. Watches agent_events (→ SSE) and approvals (pending → Messenger). Requires MONGODB_URI.
import { collections } from "@alfred/shared/db";
import { broadcast } from "./sse";
import { messenger } from "../messenger";

export async function startChangeStreams() {
  const c = await collections();

  c.agentEvents.watch([{ $match: { operationType: "insert" } }]).on("change", (ch) => {
    if (ch.operationType === "insert") broadcast(ch.fullDocument);
  });

  c.approvals.watch([{ $match: { operationType: "insert", "fullDocument.status": "pending" } }]).on("change", async (ch) => {
    if (ch.operationType !== "insert") return;
    const a = ch.fullDocument;
    // TODO(A): richer copy + product name + Smart Pay reward line
    await messenger.send(a.userId, { text: `Approve $${(a.amountCents / 100).toFixed(2)}? Reply YES ${a.shortCode} or NO ${a.shortCode}` });
  });
}
