// Owner: C. The one place /snap gets a verdict. Fixture until B's worthIt() merges — then swap the body for:
//   return worthIt({ userId, productId: product._id, product, offers, surface });
import * as fx from "@alfred/shared/fixtures";
import type { Offer, Product, Surface, Verdict } from "@alfred/shared";
import { newId } from "@alfred/shared/db";

export async function getVerdict(input: { userId: string; product: Product; offers: Offer[]; surface: Surface }): Promise<Verdict> {
  const { userId, product, offers } = input;
  const best = offers.find((o) => o.condition === "new") ?? offers[0];
  return {
    ...fx.verdict,
    _id: newId("vrd"),
    userId,
    productId: product._id,
    math: { ...fx.verdict.math, priceCents: best?.priceCents ?? fx.verdict.math.priceCents, bestOfferId: best?._id },
    createdAt: new Date(),
  };
}
