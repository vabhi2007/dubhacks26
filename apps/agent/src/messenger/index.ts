// Owner: A. MESSENGER=console logs to stdout; MESSENGER=photon texts via Photon iMessage (photon.ts).
// startMessaging() wires inbound handling (inbound.ts); POST /admin/inbound simulates a text in either mode.
import type { InboundMessage, Messenger, OutboundMessage } from "@alfred/shared";
import { env } from "../env";
import { routeInbound } from "./inbound";
import { photonSend, startPhotonInbound } from "./photon";

// Per user: the approval our most recent outbound message asked about. Any other outbound message clears it, so a bare
// YES only ever answers the approval request that was literally the last thing we said.
const lastAsked = new Map<string, string>();

async function deliver(userId: string, msg: OutboundMessage) {
  if (env.MESSENGER === "photon") return photonSend(userId, msg);
  console.log(`[messenger → ${userId}] ${msg.text}${msg.link ? ` ${msg.link}` : ""}`);
}

let handler: (msg: InboundMessage) => Promise<void> = async () => {};

export const messenger: Messenger = {
  async send(userId, msg) {
    lastAsked.delete(userId);
    await deliver(userId, msg);
  },
  /** Replaces the inbound handler (one handler, so a text never gets two replies). Delegate to `defaultInbound` to keep YES/NO handling. */
  onInbound(h) {
    handler = h;
  },
};

export const lastApprovalAsked = (userId: string) => lastAsked.get(userId);

export async function sendApprovalRequest(userId: string, approvalId: string, msg: OutboundMessage) {
  await deliver(userId, msg);
  lastAsked.set(userId, approvalId);
}

/** A's router: approval decisions, everything else to B's /chat. Replies go back through the messenger. */
export const defaultInbound = (msg: InboundMessage) => routeInbound(msg, (out) => messenger.send(msg.userId, out), lastAsked.get(msg.userId));

export const deliverInbound = (msg: InboundMessage) => handler(msg).catch((e) => console.error("[messenger] inbound handler failed:", (e as Error).message));

export function startMessaging() {
  messenger.onInbound(defaultInbound);
  if (env.MESSENGER === "photon") startPhotonInbound(deliverInbound);
}
