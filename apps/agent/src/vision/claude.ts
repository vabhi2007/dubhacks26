// Owner: C. Claude-vision fallback (and VISION_SOURCE=claude): same prompt, structured output instead of free JSON.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic } from "../agents";
import { DETECT_PROMPT, DetectionSchema, normalize, sniffMime, toBase64, type Detection } from "./detection";

export type ClaudeVisionModel = "claude-opus-5-5" | "claude-haiku-5-5";
// Haiku: same identifications as Opus on the #14 test images at ~1.1s vs ~3s (#25). It's extraction, not judgment.
export const CLAUDE_VISION_MODEL: ClaudeVisionModel = "claude-haiku-5-5";

/** `signal` is the caller's overall vision budget. No SDK retries: the budget, not retries, bounds how long a snap waits. */
export async function detectClaude(img: Uint8Array, signal?: AbortSignal, model: ClaudeVisionModel = CLAUDE_VISION_MODEL): Promise<Detection> {
  const media_type = sniffMime(img);
  if (!media_type) throw new Error("claude vision: unsupported image type");
  const res = await anthropic.beta.messages.parse(
    {
      model,
      max_tokens: 4000,
      // Server-side refusal fallback exists for Opus, not Haiku.
      ...(model === "claude-opus-5-5" && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      // Extraction, and the side panel is waiting: keep thinking short.
      output_config: { effort: "low", format: betaZodOutputFormat(DetectionSchema) },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: toBase64(img) } },
          { type: "text", text: DETECT_PROMPT },
        ],
      }],
    },
    { timeout: 20_000, maxRetries: 0, ...(signal && { signal }) },
  );
  if (res.stop_reason === "refusal") throw new Error("claude vision: model declined");
  if (!res.parsed_output) throw new Error(`claude vision: unparseable output (stop_reason=${res.stop_reason})`);
  return normalize(res.parsed_output);
}
