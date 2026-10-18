// Owner: B. Smart Pay (F4): the card (plus card-linked offer) that earns the most on a purchase.
// Card rewards are a rate by category; card-linked offers add a rate at a merchant or category until they expire.
import type { Card, CardOffer, Category } from "@alfred/shared";
import { merchantIdFor } from "@alfred/shared/db";
import { getCardOffers, getCards } from "./data";

export type CardPick = { cardId: string; name: string; last4: string; offerId?: string; ratePct: number; rewardCents: number };
export type SmartPick = CardPick & { alternatives: CardPick[] };

/** Every card's reward for this purchase, best first. Pure: cards/offers in, ranking out. */
export function rankCards(cards: Card[], offers: CardOffer[], a: { merchantId: string; category: Category; amountCents: number }): CardPick[] {
  return cards
    .map((card) => {
      const base = card.rewards[a.category] ?? card.rewards.default ?? 0;
      // At most one card-linked offer applies per purchase: the richest one matching this merchant or category.
      const offer = offers
        .filter((o) => o.cardId === card._id && (o.merchantId === a.merchantId || (o.category && o.category === a.category)))
        .sort((x, y) => y.value - x.value)[0];
      const rate = base + (offer?.value ?? 0);
      return {
        cardId: card._id, name: card.name, last4: card.last4, ...(offer && { offerId: offer._id }),
        ratePct: Math.round(rate * 1000) / 10, rewardCents: Math.round(a.amountCents * rate),
      };
    })
    .sort((x, y) => y.rewardCents - x.rewardCents || x.cardId.localeCompare(y.cardId));
}

/** Best card for buying `amountCents` at `seller` in `category`, or undefined if the user has no cards. */
export async function smartPay(a: { userId: string; seller: string; category: Category; amountCents: number }): Promise<SmartPick | undefined> {
  const cards = await getCards(a.userId);
  const ranked = rankCards(cards, await getCardOffers(cards.map((c) => c._id)), { merchantId: merchantIdFor(a.seller), category: a.category, amountCents: a.amountCents });
  const [best, ...alternatives] = ranked;
  return best && { ...best, alternatives };
}
