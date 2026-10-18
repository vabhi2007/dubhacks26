// Owner: C. Exact-model pick: Claude sees the snap plus the catalog candidates and picks one, names a product the
// catalog doesn't have, or says there's no specific product. Only called when the deterministic match is ambiguous.
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Category, type Product } from "@alfred/shared";
import { anthropic } from "../agents";
import { sniffMime, toBase64, type Detection } from "./detection";

const PICK_TIMEOUT_MS = 10_000;

const Pick = z.object({
  candidateId: z.string().nullable().describe("_id of the candidate that is exactly this product, or null if none is"),
  newProduct: z
    .object({ brand: z.string(), model: z.string(), title: z.string(), category: Category })
    .nullable()
    .describe("Only when no candidate matches but you can name the exact product (brand + model). Otherwise null."),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().describe("One short sentence: the visible detail that decided it."),
});

export type PickResult =
  | { kind: "candidate"; product: Product; confidence: string; reason: string }
  | { kind: "new"; product: Omit<Product, "_id" | "source" | "canonicalKey">; confidence: string; reason: string }
  | { kind: "none"; reason: string; guess?: string };

const SYSTEM = `You match a shopper's snap to an exact product for price lookup. The snap may be a photo, a product page, an ad, a video frame or a price tag; identify the one product it is about.
- Prefer a catalog candidate when it is exactly this product. Close variants (e.g. Bambino vs Bambino Plus, iPhone 16 vs 17) differ in visible details: buttons, steam wand, camera layout, printed model numbers. Decide from those, not from which candidate sounds closest.
- If only storage size or color differs and the snap can't show it, the candidate of that model is still the match.
- If no candidate is this product but you can name it (brand and model), return it as newProduct.
- Name a generation, year, model number or storage size only when printed text or a feature unique to that version shows it. Look-alike generations (e.g. recent iPhone Pro models) are a guess: leave the generation out of model and title (e.g. "iPhone Pro") and set confidence to low.
- If the snap shows no specific buyable product (generic items, loose food, scenery), return both as null.`;

export async function pickProduct(img: Uint8Array, d: Detection, candidates: Product[]): Promise<PickResult> {
  const media_type = sniffMime(img);
  if (!media_type) throw new Error("pick: unsupported image type");
  const catalog = candidates.map(({ _id, title, brand, model, category }) => ({ _id, title, brand, model, category }));
  const res = await anthropic.beta.messages.parse(
    {
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Pick) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: toBase64(img) } },
          {
            type: "text",
            text: `A vision model saw: caption ${JSON.stringify(d.caption ?? "")}, labels ${JSON.stringify(d.objects.map((o) => o.label))}, text read ${JSON.stringify(d.ocr)}.\n\nCatalog candidates:\n${JSON.stringify(catalog, null, 1)}`,
          },
        ],
      }],
    },
    { timeout: PICK_TIMEOUT_MS, maxRetries: 0 },
  );
  if (res.stop_reason === "refusal") throw new Error("pick: model declined");
  const p = res.parsed_output;
  if (!p) throw new Error(`pick: unparseable output (stop_reason=${res.stop_reason})`);
  const chosen = p.candidateId ? candidates.find((c) => c._id === p.candidateId) : undefined;
  if (chosen) return { kind: "candidate", product: chosen, confidence: p.confidence, reason: p.reason };
  if (p.newProduct && p.confidence !== "low") return { kind: "new", product: p.newProduct, confidence: p.confidence, reason: p.reason };
  return { kind: "none", reason: p.reason, ...(p.newProduct && { guess: p.newProduct.title }) };
}
