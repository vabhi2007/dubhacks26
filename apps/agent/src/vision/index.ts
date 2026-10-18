// Owner: C. VISION_SOURCE=perceptron | claude. MVP-0: fixed mock detection (hero product) so /snap runs end to end.
import type { Vision } from "@alfred/shared";

export type Detection = Awaited<ReturnType<Vision["detect"]>>;

export const mockVision: Vision = {
  async detect() {
    return { objects: [{ label: "espresso machine", bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.6 }, conf: 0.9 }], ocr: ["Breville", "the Bambino"] };
  },
};

// TODO(C, MVP-1): Perceptron localization + OCR; Claude-vision fallback on error or VISION_SOURCE=claude.
export const vision: Vision = mockVision;

export { resolveProduct } from "./resolve";
