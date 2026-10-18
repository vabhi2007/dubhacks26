// Owner: C. Perceptron (DESIGN.md §12): OpenAI-style /chat/completions, Bearer auth, image as a base64 data URL.
import type { Vision } from "@alfred/shared";
import { env } from "../env";
import { DETECT_PROMPT, parseDetectionText, sniffMime, toBase64 } from "./detection";

const MODEL = "perceptron-mk1.5";
const TIMEOUT_MS = 8_000;

export const perceptronVision: Vision = {
  async detect(img) {
    const base = env.PERCEPTRON_BASE_URL || "https://api.perceptron.inc/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.PERCEPTRON_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${sniffMime(img) ?? "image/png"};base64,${toBase64(img)}` } },
            { type: "text", text: DETECT_PROMPT },
          ],
        }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
    if (!res.ok) throw new Error(`perceptron HTTP ${res.status}: ${body?.error?.message ?? "no body"}`);
    const text = body?.choices?.[0]?.message?.content;
    if (!text) throw new Error("perceptron: empty reply");
    return parseDetectionText(text);
  },
};
