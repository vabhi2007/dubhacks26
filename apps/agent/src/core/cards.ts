// Owner: A. Funding card + reward math shared by purchase(), approval views and the Messenger copy.
import type { Card, Category, Mandate } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";

const rate = (card: Card, category: Category) => card.rewards[category] ?? card.rewards.default ?? 0;

/**
 * Funding card. A mandate only grants spending on its own card, so when one of the user's cards matches the mandate's
 * last4, that card is used and a conflicting `cardId` is rejected. Otherwise: `cardId`, else the best multiplier.
 */
export function pickCard(cards: Card[], category: Category, mandate?: Pick<Mandate, "_id" | "card"> | null, cardId?: string): Card {
  const bound = mandate ? cards.find((x) => x.last4 === mandate.card.last4) : undefined;
  if (bound) {
    if (cardId && cardId !== bound._id) throw new HTTPException(400, { message: `mandate ${mandate!._id} is bound to Visa ••${bound.last4}` });
    return bound;
  }
  const card = cardId ? cards.find((x) => x._id === cardId) : [...cards].sort((a, b) => rate(b, category) - rate(a, category))[0];
  if (!card) throw new HTTPException(cardId ? 400 : 409, { message: cardId ? `card ${cardId} not found` : "no card on file" });
  return card;
}

export const rewardFor = (card: Card, category: Category, amountCents: number) => Math.round(amountCents * rate(card, category));
