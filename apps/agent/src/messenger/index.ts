// Owner: A. MESSENGER=console logs to stdout; MESSENGER=photon texts via Photon iMessage (photon.ts).
// startMessaging() wires inbound handling (inbound.ts); POST /admin/inbound simulates a text in either mode.
import type { InboundMessage, Messenger } from "@alfred/shared";
import { env } from "../env";
import { routeInbound } from "./inbound";
import { photonSend, startPhotonInbound } from "./photon";

type Handler = (msg: InboundMessage) => Promise<void>;
const handlers: Handler[] = [];

export const messenger: Messenger = {
  async send(userId, msg) {
    if (env.MESSENGER === "photon") return photonSend(userId, msg);
    console.log(`[messenger → ${userId}] ${msg.text}${msg.link ? ` ${msg.link}` : ""}`);
  },
  onInbound(h) {
    handlers.push(h);
  },
};

/** Runs every registered handler (A's router first; B can add its own via messenger.onInbound). */
export async function deliverInbound(msg: InboundMessage) {
  for (const h of handlers) await h(msg).catch((e) => console.error("[messenger] handler failed:", (e as Error).message));
}

export function startMessaging() {
  messenger.onInbound((msg) => routeInbound(msg, (out) => messenger.send(msg.userId, out)));
  if (env.MESSENGER === "photon") startPhotonInbound(deliverInbound);
}
