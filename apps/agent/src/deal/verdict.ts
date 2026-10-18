// Owner: C. The one place /snap gets a verdict: B's worthIt() when there's something to judge, else a neutral one.
import { newId } from "@alfred/shared/db";
import type { Offer, Product, Surface, Verdict } from "@alfred/shared";
import { worthIt } from "../agents";
import { UNIDENTIFIED_ID } from "../vision/resolve";

/** `saved` = fetchable via GET /verdicts/:id (worthIt stores it); neutral verdicts are not, so don't link to them. */
export async function getVerdict(input: { userId: string; product: Product; offers: Offer[]; surface: Surface }): Promise<{ verdict: Verdict; saved: boolean }> {
  const { userId, product, offers, surface } = input;
  // Never hand worthIt an empty list: it would load its own unranked offers instead.
  if (offers.length) {
    try {
      return { verdict: await worthIt({ userId, productId: product._id, product, offers, surface }), saved: true };
    } catch (e) {
      console.warn("getVerdict: worthIt failed, returning a neutral verdict:", (e as Error).message);
    }
  }
  return { verdict: neutralVerdict(userId, product, offers), saved: false };
}

function neutralVerdict(userId: string, product: Product, offers: Offer[]): Verdict {
  const priced = offers.length > 0;
  const [headline, reason] =
    product._id === UNIDENTIFIED_ID
      ? ["Couldn't identify this product yet.", `Best guess: "${product.title}". Try snapping closer to the brand or model name.`]
      : priced
        ? [`Couldn't check ${product.title} against your spending right now.`, "The prices below are live, but the Worth-It check didn't finish — try again in a moment."]
        : [`No matching prices for ${product.title} yet.`, "None of the listings found were an exact or close match from a seller I trust."];
  return {
    _id: newId("vrd"),
    userId,
    productId: product._id,
    kind: "wait",
    mode: "worth_it",
    headline,
    reasons: [reason],
    math: { priceCents: offers[0]?.priceCents ?? 0, ...(offers[0] && { bestOfferId: offers[0]._id }) },
    createdAt: new Date(),
  };
}
