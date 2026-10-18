// Owner: A. Funding card + reward math shared by purchase(), approval views and the Messenger copy.
import type { Card, Category, Mandate } from "@alfred/shared";
import { HTTPException } from "hono/http-exception";

const rate = (card: Card, category: Category) => card.rewards[category] ?? card.rewards.default ?? 0;

/** Funding card: explicit pick, else the card behind the mandate's last4, else the best multiplier for the category. */
export function pickCard(cards: Card[], category: Category, mandate?: Pick<Mandate, "card"> | null, cardId?: string): Card {
  const card = cardId
    ? cards.find((x) => x._id === cardId)
    : (cards.find((x) => x.last4 === mandate?.card.last4) ?? [...cards].sort((a, b) => rate(b, category) - rate(a, category))[0]);
  if (!card) throw new HTTPException(cardId ? 400 : 409, { message: cardId ? `card ${cardId} not found` : "no card on file" });
  return card;
}

export const rewardFor = (card: Card, category: Category, amountCents: number) => Math.round(amountCents * rate(card, category));
