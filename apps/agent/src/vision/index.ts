// Owner: C. VISION_SOURCE=perceptron (Claude fallback) | claude | mock. No vision keys at all → mock too.
import type { Vision } from "@alfred/shared";
import { env } from "../env";
import { detectClaude } from "./claude";
import { EMPTY_DETECTION, isEmptyDetection, type Detection } from "./detection";
import { detectPerceptron } from "./perceptron";

export type { Detection } from "./detection";
export { sniffMime } from "./detection";

/** One budget for all providers together, so a snap never waits on vision longer than this. */
export const VISION_BUDGET_MS = 12_000;

export const mockVision: Vision = {
  async detect() {
    return { objects: [{ label: "espresso machine", bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.6 }, conf: 0.9 }], ocr: ["Breville", "the Bambino"] };
  },
};

type Provider = [name: string, detect: (img: Uint8Array, signal: AbortSignal) => Promise<Detection>];

function providerChain(): Provider[] {
  if (env.VISION_SOURCE === "mock") return [];
  if (env.VISION_SOURCE === "perceptron" && !env.PERCEPTRON_API_KEY) console.warn("vision: VISION_SOURCE=perceptron but PERCEPTRON_API_KEY is not set — using Claude only");
  const chain: Provider[] = [];
  if (env.VISION_SOURCE === "perceptron" && env.PERCEPTRON_API_KEY) chain.push(["perceptron", detectPerceptron]);
  if (env.ANTHROPIC_API_KEY) chain.push(["claude", (img, signal) => detectClaude(img, signal)]);
  return chain;
}

const providers = providerChain();
if (!providers.length) console.log(`vision: mock detection (${env.VISION_SOURCE === "mock" ? "VISION_SOURCE=mock" : "no PERCEPTRON_API_KEY / ANTHROPIC_API_KEY"})`);

/**
 * First provider with a usable answer wins. An error or an empty answer moves on to the next provider; when the budget
 * runs out or every provider misses, the result is an empty detection (→ "couldn't identify"), never a guess.
 */
export const vision: Vision = providers.length
  ? {
      async detect(img) {
        const budget = AbortSignal.timeout(VISION_BUDGET_MS);
        for (const [name, detect] of providers) {
          if (budget.aborted) break;
          const t0 = Date.now();
          try {
            const d = await detect(img, budget);
            const took = `${name} ${Date.now() - t0}ms`;
            if (isEmptyDetection(d)) {
              console.warn(`vision: ${took} · nothing usable, trying the next provider`);
              continue;
            }
            console.log(`vision: ${took} · ${d.objects[0]?.label ?? "no object"} · "${d.caption ?? ""}" · ocr [${d.ocr.join(" | ")}]`);
            return d;
          } catch (e) {
            console.warn(`vision: ${name} failed after ${Date.now() - t0}ms:`, budget.aborted ? `vision budget (${VISION_BUDGET_MS}ms) used up` : (e as Error).message);
          }
        }
        return EMPTY_DETECTION;
      },
    }
  : mockVision;

export { NEW_PRODUCT_PREFIX, resolveProduct, type Resolution } from "./resolve";
