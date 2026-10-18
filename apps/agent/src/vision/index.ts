// Owner: C. VISION_SOURCE=perceptron (Claude fallback on error) | claude. No vision keys at all → mock detection.
import type { Vision } from "@alfred/shared";
import { env } from "../env";
import { claudeVision } from "./claude";
import { EMPTY_DETECTION } from "./detection";
import { perceptronVision } from "./perceptron";

export type { Detection } from "./detection";
export { sniffMime } from "./detection";

export const mockVision: Vision = {
  async detect() {
    return { objects: [{ label: "espresso machine", bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.6 }, conf: 0.9 }], ocr: ["Breville", "the Bambino"] };
  },
};

const providers: [string, Vision][] = (
  [
    ["perceptron", perceptronVision, env.VISION_SOURCE === "perceptron" && !!env.PERCEPTRON_API_KEY],
    ["claude", claudeVision, !!env.ANTHROPIC_API_KEY],
  ] as const
).flatMap(([name, v, on]) => (on ? [[name, v] as [string, Vision]] : []));

if (!providers.length) console.warn("vision: no PERCEPTRON_API_KEY / ANTHROPIC_API_KEY — using mock detection");

/** First provider that answers wins. If they all fail, an empty detection (→ "couldn't identify"), never a guess. */
export const vision: Vision = providers.length
  ? {
      async detect(img) {
        for (const [name, v] of providers) {
          const t0 = Date.now();
          try {
            const d = await v.detect(img);
            console.log(`vision: ${name} ${Date.now() - t0}ms · ${d.objects[0]?.label ?? "no object"} · "${d.caption ?? ""}" · ocr [${d.ocr.join(" | ")}]`);
            return d;
          } catch (e) {
            console.warn(`vision: ${name} failed after ${Date.now() - t0}ms:`, (e as Error).message);
          }
        }
        return EMPTY_DETECTION;
      },
    }
  : mockVision;

export { resolveProduct, type Resolution } from "./resolve";
