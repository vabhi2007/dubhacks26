// Owner: A. MESSENGER=photon — iMessage via Photon 2.0 (spectrum-ts). Inbound uses the SDK's streaming connection
// (`app.messages`, outbound from this machine), so nothing is exposed and no tunnel is needed (DESIGN.md §12).
// Safety: only DEMO_USER_PHONE (+ MESSENGER_ALLOWLIST) is ever texted, and inbound from any other number is ignored.
// Run MESSENGER=photon on one machine only — every photon-mode agent would receive and answer the same texts.
import { collections } from "@alfred/shared/db";
import type { InboundMessage, OutboundMessage } from "@alfred/shared";
import { Spectrum, attachment, text, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers";
import { env } from "../env";

/** "+1 (206) 555-0142" / "2065550142" → "+12065550142". */
export const normalizePhone = (raw: string | undefined) => {
  const digits = (raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
};

const DEMO_PHONE = normalizePhone(process.env.DEMO_USER_PHONE);
const ALLOWED = new Set([DEMO_PHONE, ...(process.env.MESSENGER_ALLOWLIST ?? "").split(",").map(normalizePhone)].filter(Boolean));

const connect = () => {
  const projectId = env.PHOTON_PROJECT_ID;
  const projectSecret = env.PHOTON_PROJECT_SECRET;
  if (!projectId || !projectSecret) throw new Error("PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET not set");
  return Spectrum({ projectId, projectSecret, providers: [imessage.config()], options: { flattenGroups: true }, telemetry: false });
};
type App = Awaited<ReturnType<typeof connect>>;
let appPromise: Promise<App> | undefined;
const app = () =>
  (appPromise ??= connect().catch((e) => {
    appPromise = undefined;
    throw e;
  }));

const spaces = new Map<string, Space>();
async function spaceFor(phone: string) {
  let s = spaces.get(phone);
  if (!s) spaces.set(phone, (s = await imessage(await app()).space.create(phone)));
  return s;
}

async function phoneFor(userId: string) {
  if (userId === env.DEMO_USER_ID) return DEMO_PHONE;
  return normalizePhone((await (await collections()).users.findOne({ _id: userId }))?.phone);
}

async function userFor(phone: string) {
  if (phone === DEMO_PHONE) return env.DEMO_USER_ID;
  return (await (await collections()).users.findOne({ phone }))?._id;
}

export async function photonSend(userId: string, msg: OutboundMessage) {
  const phone = await phoneFor(userId);
  if (!phone || !ALLOWED.has(phone)) {
    console.warn(`[photon] not texting ${userId}: ${phone ? "number not in DEMO_USER_PHONE / MESSENGER_ALLOWLIST" : "no phone"} — "${msg.text.slice(0, 60)}"`);
    return;
  }
  const space = await spaceFor(phone);
  await space.send(text(msg.link ? `${msg.text}\n${msg.link}` : msg.text));
  if (msg.imageUrl && !msg.imageUrl.includes("placehold.co")) await space.send(attachment(new URL(msg.imageUrl)));
}

/**
 * Reads the inbound stream forever (reconnecting with backoff) and hands each allowed message to `deliver` without
 * blocking the stream. Only 1:1 DMs count — a group chat must never become the channel for receipts or approvals — and
 * messages from before this process started are skipped, so a redelivered old "yes" can't answer a newer approval.
 */
export function startPhotonInbound(deliver: (msg: InboundMessage) => Promise<void>) {
  if (!DEMO_PHONE) console.warn("[photon] DEMO_USER_PHONE not set — inbound texts will all be ignored and nothing will be sent");
  const startedAt = Date.now() - 5_000; // small allowance for clock skew with Photon's timestamps
  const seen = new Set<string>(); // the stream is at-least-once
  const order = new Map<string, Promise<void>>();
  let failures = 0;
  const listen = async () => {
    try {
      for await (const [space, message] of (await app()).messages) {
        failures = 0;
        if (message.direction !== "inbound" || seen.has(message.id)) continue;
        seen.add(message.id);
        if (seen.size > 5000) seen.delete(seen.values().next().value!);
        if (message.timestamp.getTime() < startedAt) continue;
        if (imessage(space).type !== "dm") continue;
        const phone = normalizePhone(message.sender?.id);
        if (!ALLOWED.has(phone)) continue; // never answer strangers
        const c = message.content;
        if (c.type !== "text" && !(c.type === "attachment" && c.mimeType.startsWith("image/"))) continue;
        spaces.set(phone, space);
        // Prepare in arrival order per sender (a photo read must not let its caption overtake it); handle without blocking.
        const prepared = (order.get(phone) ?? Promise.resolve()).then(async (): Promise<InboundMessage | undefined> => {
          const userId = await userFor(phone);
          if (!userId) return undefined;
          const imageUrls = c.type === "attachment" ? [`data:${c.mimeType};base64,${(await c.read()).toString("base64")}`] : [];
          return { userId, text: c.type === "text" ? c.text : "", imageUrls, channel: "imessage" };
        });
        order.set(phone, prepared.then(() => {}, () => {}));
        void prepared
          .then((inbound) => inbound && space.responding(() => deliver(inbound)))
          .catch((e) => console.error("[photon] inbound handler failed:", (e as Error).message));
      }
      console.warn("[photon] inbound stream ended — reconnecting");
    } catch (e) {
      console.error("[photon] inbound stream error:", (e as Error).message);
      appPromise = undefined;
    }
    setTimeout(listen, Math.min(30_000, 1000 * 2 ** ++failures));
  };
  void listen();
  console.log(`[photon] listening for iMessages from ${[...ALLOWED].map((p) => `…${p.slice(-4)}`).join(", ") || "nobody"}`);
}
