// Owner: C. VISION_SOURCE=perceptron | claude. Mock returns a fixed detection until implemented.
import type { Vision } from "@alfred/shared";

export const vision: Vision = {
  async detect() {
    // TODO(C): Perceptron localization + OCR; Claude-vision fallback.
    return { objects: [{ label: "espresso machine", bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.6 }, conf: 0.9 }], ocr: ["Breville", "the Bambino"] };
  },
};
