// Owner: B. Routes for Visa's Trusted Agent Protocol:
//   GET  /tap/keys?keyID=                — Alfred's public key directory (mirrors Visa's Public Key Retrieval GET /keys?keyID=)
//   GET  /tap/status                     — key id, whether it's pinned, mode
//   POST /tap/merchant/:merchantId/checkout — a mock merchant that runs the spec's verification steps before accepting an order
//   GET  /tap/selftest                   — signed / replayed / tampered / expired / forged requests against that merchant
// Merchants in the demo are mocks (no real merchant verifies Alfred's self-published key yet); the protocol is real.
import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { agentKey, jwkToPublicKey, type AgentJwk } from "./keys";
import { MAX_WINDOW_S, signPaymentContainer, signRequest, verifyPaymentContainer, verifyRequest } from "./signatures";

export const tap = new Hono();

tap.get("/tap/keys", (c) => {
  const { jwk } = agentKey();
  const id = c.req.query("keyID");
  if (id && id !== jwk.kid) return c.json({ error: "unknown keyID" }, 404);
  return c.json(jwk);
});

tap.get("/tap/status", (c) => c.json({ mode: tapMode(), keyid: agentKey().jwk.kid, pinned: !!process.env.TAP_PRIVATE_KEY, alg: "Ed25519" }));

export const tapMode = () => (process.env.TAP === "off" ? "off" : "mock");

// ---------- mock merchant ----------

/** The merchant's key cache, filled from the key directory on first sight of a keyid (spec: "Locate the public key"). */
const keyCache = new Map<string, KeyObject>();
async function resolveKey(keyid: string) {
  const hit = keyCache.get(keyid);
  if (hit) return hit;
  const res = await tap.request(`/tap/keys?keyID=${encodeURIComponent(keyid)}`);
  if (!res.ok) return undefined;
  const key = jwkToPublicKey((await res.json()) as AgentJwk);
  keyCache.set(keyid, key);
  return key;
}

const CheckoutBody = z.object({
  orderRef: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.literal("USD"),
  agenticPaymentContainer: z.record(z.string(), z.unknown()),
});

tap.post("/tap/merchant/:merchantId/checkout", async (c) => {
  const url = new URL(c.req.url);
  const msg = await verifyRequest(
    { authority: url.host, path: url.pathname, signatureInput: c.req.header("signature-input"), signature: c.req.header("signature") },
    resolveKey,
    "agent-payer-auth",
  );
  if (!msg.ok) return c.json({ status: "blocked", reason: msg.reason }, 401);
  const body = CheckoutBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ status: "blocked", reason: "malformed checkout body" }, 400);
  const pc = body.data.agenticPaymentContainer;
  const container = await verifyPaymentContainer(pc, msg.nonce, resolveKey);
  if (!container.ok) return c.json({ status: "blocked", reason: container.reason }, 401);
  if (pc.kid !== msg.keyid) return c.json({ status: "blocked", reason: "container kid differs from the message keyid" }, 401);
  // The signed container is what the agent committed to; the unsigned body must agree with it.
  if (pc.amountCents !== body.data.amountCents || pc.merchantId !== c.req.param("merchantId") || pc.orderRef !== body.data.orderRef)
    return c.json({ status: "blocked", reason: "checkout does not match the signed payment container" }, 401);
  return c.json({ status: "accepted", merchantOrderId: `mco_${randomBytes(6).toString("hex")}`, keyid: msg.keyid }, 201);
});

// ---------- self-test ----------

tap.get("/tap/selftest", async (c) => {
  const origin = new URL(c.req.url).origin;
  const target = (m: string) => `${origin}/tap/merchant/${m}/checkout`;
  const post = async (url: string, headers: Record<string, string>, body: unknown) =>
    tap.request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  const checkout = (m: string, nonce: string, amountCents = 4999, signer?: Parameters<typeof signPaymentContainer>[2]) => {
    const orderRef = `selftest_${randomBytes(4).toString("hex")}`;
    const container = signPaymentContainer(nonce, { merchantId: m, orderRef, amountCents, currency: "USD", cardMetadata: { lastFour: "4242" } }, signer);
    return { orderRef, amountCents, currency: "USD", agenticPaymentContainer: container };
  };
  const stranger = (() => {
    const privateKey = generateKeyPairSync("ed25519").privateKey;
    return { privateKey, jwk: { kid: "stranger-key" } };
  })();

  const cases: { name: string; expect: "accepted" | "blocked"; run: () => Promise<Response> }[] = [];
  const ok = signRequest(target("mrc_demo"), "agent-payer-auth");
  const okBody = checkout("mrc_demo", ok.nonce);
  cases.push({ name: "Signed checkout from Alfred", expect: "accepted", run: () => post(target("mrc_demo"), ok.headers, okBody) });
  cases.push({ name: "Same request replayed", expect: "blocked", run: () => post(target("mrc_demo"), ok.headers, okBody) });
  cases.push({ name: "No signature (an unknown bot)", expect: "blocked", run: () => post(target("mrc_demo"), {}, okBody) });
  const moved = signRequest(target("mrc_demo"), "agent-payer-auth");
  cases.push({ name: "Signature reused at another merchant", expect: "blocked", run: () => post(target("mrc_other"), moved.headers, checkout("mrc_other", moved.nonce)) });
  const stale = signRequest(target("mrc_demo"), "agent-payer-auth", { now: Date.now() - (MAX_WINDOW_S + 60) * 1000 });
  cases.push({ name: "Expired signature", expect: "blocked", run: () => post(target("mrc_demo"), stale.headers, checkout("mrc_demo", stale.nonce)) });
  const long = signRequest(target("mrc_demo"), "agent-payer-auth", { ttlS: 60 * 60 });
  cases.push({ name: "Validity window over 8 minutes", expect: "blocked", run: () => post(target("mrc_demo"), long.headers, checkout("mrc_demo", long.nonce)) });
  const browse = signRequest(target("mrc_demo"), "agent-browser-auth");
  cases.push({ name: "Browsing signature used to pay", expect: "blocked", run: () => post(target("mrc_demo"), browse.headers, checkout("mrc_demo", browse.nonce)) });
  const forged = signRequest(target("mrc_demo"), "agent-payer-auth", { signer: stranger });
  cases.push({ name: "Signed by an untrusted key", expect: "blocked", run: () => post(target("mrc_demo"), forged.headers, checkout("mrc_demo", forged.nonce, 4999, stranger)) });
  const bumped = signRequest(target("mrc_demo"), "agent-payer-auth");
  cases.push({
    name: "Amount changed after signing",
    expect: "blocked",
    run: () => {
      const b = checkout("mrc_demo", bumped.nonce);
      return post(target("mrc_demo"), bumped.headers, { ...b, amountCents: 1, agenticPaymentContainer: { ...b.agenticPaymentContainer, amountCents: 1 } });
    },
  });
  const a = signRequest(target("mrc_demo"), "agent-payer-auth"), b = signRequest(target("mrc_demo"), "agent-payer-auth");
  cases.push({ name: "Payment container from another request", expect: "blocked", run: () => post(target("mrc_demo"), a.headers, checkout("mrc_demo", b.nonce)) });

  const results = [];
  for (const k of cases) {
    const res = await k.run();
    const out = (await res.json()) as { status: string; reason?: string };
    results.push({ name: k.name, expect: k.expect, got: out.status, reason: out.reason, pass: out.status === k.expect });
  }
  return c.json({ keyid: agentKey().jwk.kid, pass: results.every((r) => r.pass), results });
});
