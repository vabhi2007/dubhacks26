// Owner: B. Trusted Agent Protocol message signatures (Visa TAP merchant spec, built on RFC 9421 HTTP Message Signatures)
// and the signed Agentic Payment Container. Signing is the agent's side; verification is what a merchant (or our mock
// merchant) runs. Ed25519 throughout.
import { randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { agentKey } from "./keys";

export type TapTag = "agent-browser-auth" | "agent-payer-auth";
const TAGS = new Set<string>(["agent-browser-auth", "agent-payer-auth"]);
/** Spec: created and expires must be no more than 8 minutes apart; nonces are remembered for the same window. */
export const MAX_WINDOW_S = 8 * 60;
const CLOCK_SKEW_S = 5;
const LABEL = "sig2";

/** Defaults to Alfred's key; the self-test passes a stranger's key to prove the merchant rejects it. */
type Signer = { privateKey: KeyObject; jwk: { kid: string } };
type Params = { created: number; expires: number; keyid: string; alg: string; nonce: string; tag: string };

/** RFC 9421 §2.5 signature base for ("@authority" "@path"). */
function signatureBase(authority: string, path: string, paramsValue: string) {
  return `"@authority": ${authority}\n"@path": ${path}\n"@signature-params": ${paramsValue}`;
}

const paramsValue = (p: Params) =>
  `("@authority" "@path");created=${p.created};keyid="${p.keyid}";alg="${p.alg}";expires=${p.expires};nonce="${p.nonce}";tag="${p.tag}"`;

/** Agent side: the Signature-Input / Signature headers for a request to `url`. */
export function signRequest(url: string, tag: TapTag, opts: { now?: number; ttlS?: number; nonce?: string; signer?: Signer } = {}) {
  const { privateKey, jwk } = opts.signer ?? agentKey();
  const u = new URL(url);
  const created = Math.floor((opts.now ?? Date.now()) / 1000);
  const p: Params = { created, expires: created + (opts.ttlS ?? MAX_WINDOW_S), keyid: jwk.kid, alg: "Ed25519", nonce: opts.nonce ?? randomBytes(64).toString("base64"), tag };
  const value = paramsValue(p);
  const sig = sign(null, Buffer.from(signatureBase(u.host, u.pathname, value)), privateKey).toString("base64");
  return {
    headers: { "Signature-Input": `${LABEL}=${value}`, Signature: `${LABEL}=:${sig}:` },
    nonce: p.nonce,
    keyid: p.keyid,
  };
}

/** Canonical string for a payment container: every field in received order except `signature` (spec). */
const containerBase = (c: Record<string, unknown>) => {
  const { signature: _, ...rest } = c;
  return JSON.stringify(rest);
};

/** Agent side: sign an Agentic Payment Container linked to the request by the same nonce and key. */
export function signPaymentContainer(nonce: string, data: Record<string, unknown>, signer: Signer = agentKey()) {
  const { privateKey, jwk } = signer;
  const unsigned = { nonce, ...data, kid: jwk.kid, alg: "Ed25519" };
  return { ...unsigned, signature: sign(null, Buffer.from(containerBase(unsigned)), privateKey).toString("base64") };
}

// ---------- merchant side ----------

export type Verdict = { ok: true; keyid: string; tag: string; nonce: string } | { ok: false; reason: string };
export type KeyResolver = (keyid: string) => Promise<KeyObject | undefined>;

/** Nonces seen in the last 8 minutes (spec: block replays). Per process — one merchant. */
const seen = new Map<string, number>();
function replayed(nonce: string, nowS: number) {
  for (const [n, exp] of seen) if (exp < nowS) seen.delete(n);
  if (seen.has(nonce)) return true;
  seen.set(nonce, nowS + MAX_WINDOW_S);
  return false;
}

function parseInput(header: string | undefined) {
  const m = header?.match(/^\s*([A-Za-z0-9_-]+)=\(([^)]*)\)(.*)$/);
  if (!m) return undefined;
  const params: Record<string, string> = {};
  for (const [, k, v] of m[3]!.matchAll(/;\s*([a-z]+)=("([^"]*)"|[^;]+)/g)) params[k!] = v!.startsWith('"') ? v!.slice(1, -1) : v!.trim();
  return { label: m[1]!, components: m[2]!.split(/\s+/).filter(Boolean), raw: `(${m[2]})${m[3]}`, params };
}

/**
 * Merchant side: TAP "Signature Verification" steps for an incoming request — trusted-agent tag, minimum fields,
 * timestamps (created in the past, expires in the future, ≤ 8 min apart), nonce not replayed, key located, signature valid.
 */
export async function verifyRequest(
  req: { authority: string; path: string; signatureInput?: string; signature?: string },
  resolveKey: KeyResolver,
  expectTag?: TapTag,
): Promise<Verdict> {
  const input = parseInput(req.signatureInput);
  if (!input) return { ok: false, reason: "no message signature (not a trusted agent)" };
  const p = input.params;
  if (!p.tag || !TAGS.has(p.tag)) return { ok: false, reason: "signature is not tagged as a trusted agent" };
  if (expectTag && p.tag !== expectTag) return { ok: false, reason: `expected tag ${expectTag}, got ${p.tag}` };
  const missing = ["created", "expires", "keyid", "alg", "nonce"].filter((k) => !p[k]);
  if (!input.components.includes('"@authority"') || !input.components.includes('"@path"')) missing.push("@authority/@path");
  if (missing.length) return { ok: false, reason: `missing ${missing.join(", ")}` };
  if (p.alg !== "Ed25519") return { ok: false, reason: `unsupported alg ${p.alg}` };

  const now = Math.floor(Date.now() / 1000);
  const created = Number(p.created), expires = Number(p.expires);
  if (!(created <= now + CLOCK_SKEW_S)) return { ok: false, reason: "created is in the future" };
  if (!(expires > now)) return { ok: false, reason: "signature expired" };
  if (expires - created > MAX_WINDOW_S) return { ok: false, reason: "validity window longer than 8 minutes" };

  const sigMatch = req.signature?.match(new RegExp(`${input.label}=:([^:]+):`));
  if (!sigMatch) return { ok: false, reason: "Signature header missing or label mismatch" };
  const key = await resolveKey(p.keyid!);
  if (!key) return { ok: false, reason: "unknown keyid (public key not found)" };
  const base = signatureBase(req.authority, req.path, input.raw);
  if (!verify(null, Buffer.from(base), key, Buffer.from(sigMatch[1]!, "base64"))) return { ok: false, reason: "signature does not match the request" };
  // Replay check last, so a forged request can't burn a legitimate nonce.
  if (replayed(p.nonce!, now)) return { ok: false, reason: "nonce replayed" };
  return { ok: true, keyid: p.keyid!, tag: p.tag, nonce: p.nonce! };
}

/** Merchant side: Agentic Payment Container checks — minimum fields, nonce matches the message signature, signature valid. */
export async function verifyPaymentContainer(c: Record<string, unknown> | undefined, nonce: string, resolveKey: KeyResolver): Promise<Verdict> {
  if (!c) return { ok: false, reason: "no agenticPaymentContainer" };
  const missing = ["nonce", "kid", "alg", "signature"].filter((k) => typeof c[k] !== "string");
  if (missing.length) return { ok: false, reason: `container missing ${missing.join(", ")}` };
  if (c.nonce !== nonce) return { ok: false, reason: "container nonce does not match the message signature" };
  const key = await resolveKey(c.kid as string);
  if (!key) return { ok: false, reason: "unknown container kid" };
  if (!verify(null, Buffer.from(containerBase(c)), key, Buffer.from(c.signature as string, "base64"))) return { ok: false, reason: "container signature invalid" };
  return { ok: true, keyid: c.kid as string, tag: "agent-payer-auth", nonce };
}
