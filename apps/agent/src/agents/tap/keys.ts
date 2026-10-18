// Owner: B. Alfred's agent signing key for Visa's Trusted Agent Protocol (TAP): an Ed25519 key, identified by its
// RFC 7638 JWK thumbprint, published at GET /tap/keys?keyID= (mirrors Visa's Public Key Retrieval: GET /keys?keyID=).
// TAP_PRIVATE_KEY (PKCS#8 PEM, `\n` escapes allowed) pins the key; without it a key is generated per process — fine for
// the demo, since the merchant fetches the public key by keyid from this same service.
// Note: a real Visa-approved agent's keys are published by Visa; ours are self-published, and the UI says so.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";

export type AgentJwk = { kty: "OKP"; crv: "Ed25519"; x: string; kid: string; use: "sig"; alg: "Ed25519" };

let cached: { privateKey: KeyObject; jwk: AgentJwk } | undefined;

function load() {
  const pem = process.env.TAP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const privateKey = pem ? createPrivateKey(pem) : generateKeyPairSync("ed25519").privateKey;
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("TAP_PRIVATE_KEY must be an Ed25519 key");
  const { x } = createPublicKey(privateKey).export({ format: "jwk" }) as { x: string };
  // RFC 7638 thumbprint: SHA-256 over the required members in lexicographic order.
  const kid = createHash("sha256").update(JSON.stringify({ crv: "Ed25519", kty: "OKP", x })).digest("base64url");
  if (!pem) console.log(`[tap] generated an ephemeral agent key (set TAP_PRIVATE_KEY to pin it) · keyid ${kid}`);
  return { privateKey, jwk: { kty: "OKP", crv: "Ed25519", x, kid, use: "sig", alg: "Ed25519" } as AgentJwk };
}

export function agentKey() {
  return (cached ??= load());
}

/** Turn a published JWK back into a verification key. */
export const jwkToPublicKey = (jwk: Pick<AgentJwk, "kty" | "crv" | "x">) => createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: "jwk" });
