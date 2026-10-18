// Owner: A. MESSENGER=console logs to stdout; MESSENGER=photon uses Photon 2.0 (TODO).
import type { Messenger } from "@alfred/shared";
import { env } from "../env";

const consoleMessenger: Messenger = {
  async send(userId, msg) {
    console.log(`[messenger → ${userId}] ${msg.text}${msg.link ? ` ${msg.link}` : ""}`);
  },
  onInbound() {},
};

// TODO(A): implement photonMessenger with spectrum-ts and select it when env.MESSENGER === "photon".
export const messenger: Messenger = env.MESSENGER === "photon" ? consoleMessenger : consoleMessenger;
