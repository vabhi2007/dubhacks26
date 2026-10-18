// Owner: C. Label raw shopping results against the product we're pricing: exact / variant / different, new / used /
// refurb, region. Bulk classification → claude-haiku-5-5 (CLAUDE.md), one structured-output call per search.
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Product, RawOffer } from "@alfred/shared";
import { anthropic } from "../agents";

const TIMEOUT_MS = 8_000;

const Labels = z.object({
  items: z.array(
    z.object({
      i: z.number().int().describe("index of the listing"),
      matched: z.enum(["exact", "variant", "different"]),
      condition: z.enum(["new", "used", "refurb"]),
      region: z.string().describe("ISO country the seller ships from / prices in, e.g. US, UK, CA"),
      suspicious: z.boolean().describe("true when the seller looks like bait: a store unrelated to this kind of product, or a price far below what this product really sells for"),
    }),
  ),
  typicalUsdPrice: z.number().nullable().describe("Typical new US retail price of the target product in USD, from your knowledge; null if unsure"),
});
export type Label = z.infer<typeof Labels>["items"][number];
export type Labeled = { labels: Label[]; typicalCents?: number };

const SYSTEM = `You label Google Shopping listings against one target product so a shopper sees only real prices for it.
For every listing return:
- matched: "exact" = this exact model (color or finish differences still count as exact). "variant" = same product line but a different configuration: a bundle with other items, a different storage size, or a regional twin sold under another name (e.g. Sage for Breville outside North America). "different" = another model, a predecessor or successor, parts or accessories, or anything you're unsure is this product.
- condition: "new" unless the listing says used, pre-owned, open-box or refurbished ("refurb").
- region: where the seller is. Default US for US retailers and marketplaces; use the seller name, title wording or an implausible price for the US to spot foreign stores.
- suspicious: bait listings copy the right title at a too-good price from a store that doesn't sell this kind of thing (e.g. a jewellery or catering site selling a coffee grinder). Mark those; ordinary retailers, specialty shops and marketplaces are not suspicious.
Also give typicalUsdPrice: what this product normally sells for new in the US, if you know it.`;

export async function labelOffers(product: Product, raw: RawOffer[]): Promise<Labeled> {
  if (!raw.length) return { labels: [] };
  const listings = raw.map((r, i) => ({ i, title: r.title, seller: r.seller, price: `$${(r.priceCents / 100).toFixed(2)}`, condition_hint: r.condition }));
  const res = await anthropic.beta.messages.parse(
    {
      model: "claude-haiku-5-5",
      max_tokens: 8000,
      // A 25-row classification needs no deliberation: thinking off (allowed on Haiku 5.5 at effort ≤ high).
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: betaZodOutputFormat(Labels) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Target product: ${JSON.stringify({ title: product.title, brand: product.brand, model: product.model })}\n\nListings:\n${JSON.stringify(listings)}`,
      }],
    },
    { timeout: TIMEOUT_MS, maxRetries: 0 },
  );
  if (res.stop_reason === "refusal") throw new Error("label: model declined");
  if (!res.parsed_output) throw new Error(`label: unparseable output (stop_reason=${res.stop_reason})`);
  // Keep one label per listing index the model actually saw.
  const byIndex = new Map(res.parsed_output.items.filter((l) => l.i >= 0 && l.i < raw.length).map((l) => [l.i, l] as const));
  const labels = raw.map((_, i) => byIndex.get(i) ?? { i, matched: "different" as const, condition: raw[i]!.condition, region: raw[i]!.region, suspicious: false });
  const typical = res.parsed_output.typicalUsdPrice;
  return { labels, ...(typical && typical > 0 && { typicalCents: Math.round(typical * 100) }) };
}
