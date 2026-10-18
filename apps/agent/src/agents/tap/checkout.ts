// Owner: B. The agent side of a Trusted Agent Protocol checkout, called by purchase() after the mandate authorizes and
// before the order is written: sign the request (tag agent-payer-auth) and an Agentic Payment Container bound to it by
// nonce, send both to the merchant, and report whether the merchant accepted. TAP=off skips it.
import { createHash } from "node:crypto";
import { env } from "../../env";
import { tap, tapMode } from "./merchant";
import { signPaymentContainer, signRequest } from "./signatures";

export type TapCheckout = { ok: true; keyid: string; merchantOrderId: string } | { ok: false; reason: string };

export async function tapCheckout(o: { merchantId: string; orderRef: string; amountCents: number; card: { last4: string; token: string } }): Promise<TapCheckout | undefined> {
  if (tapMode() === "off") return undefined;
  // Mock merchants live in this service; the request goes through their router in-process (no network) so purchase()
  // also works from scripts, and the signature still covers this URL's real authority + path.
  const url = `http://127.0.0.1:${env.AGENT_PORT}/tap/merchant/${encodeURIComponent(o.merchantId)}/checkout`;
  const signed = signRequest(url, "agent-payer-auth");
  const container = signPaymentContainer(signed.nonce, {
    merchantId: o.merchantId,
    orderRef: o.orderRef,
    amountCents: o.amountCents,
    currency: "USD",
    paymentCredentialsHash: createHash("sha256").update(o.card.token).digest("base64url"),
    cardMetadata: { lastFour: o.card.last4 },
  });
  const res = await tap.request(url, {
    method: "POST",
    headers: { ...signed.headers, "content-type": "application/json" },
    body: JSON.stringify({ orderRef: o.orderRef, amountCents: o.amountCents, currency: "USD", agenticPaymentContainer: container }),
  });
  const out = (await res.json().catch(() => ({}))) as { status?: string; reason?: string; merchantOrderId?: string };
  if (res.ok && out.status === "accepted") return { ok: true, keyid: signed.keyid, merchantOrderId: out.merchantOrderId! };
  return { ok: false, reason: out.reason ?? `merchant returned ${res.status}` };
}
