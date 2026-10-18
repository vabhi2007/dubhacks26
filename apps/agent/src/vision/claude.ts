// Owner: C. Claude-vision fallback (and VISION_SOURCE=claude): same prompt, structured output instead of free JSON.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Vision } from "@alfred/shared";
import { anthropic } from "../agents";
import { DETECT_PROMPT, DetectionSchema, normalize, sniffMime, toBase64 } from "./detection";

export const claudeVision: Vision = {
  async detect(img) {
    const media_type = sniffMime(img);
    if (!media_type) throw new Error("claude vision: unsupported image type");
    const res = await anthropic.beta.messages.parse(
      {
        model: "claude-opus-5-5",
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
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
      { timeout: 20_000, maxRetries: 1 },
    );
    if (res.stop_reason === "refusal") throw new Error("claude vision: model declined");
    if (!res.parsed_output) throw new Error(`claude vision: unparseable output (stop_reason=${res.stop_reason})`);
    return normalize(res.parsed_output);
  },
};
