// Owner: A. GET /stats — the dashboard's headline numbers.
import { collections } from "@alfred/shared/db";
import type { Stats } from "@alfred/shared";

export async function getStats(userId: string): Promise<Stats> {
  const c = await collections();
  const [[agg], activeWatches] = await Promise.all([
    c.orders
      .aggregate<{ saved: number; rewards: number; n: number }>([
        { $match: { userId } },
        { $group: { _id: null, saved: { $sum: { $ifNull: ["$savedCents", 0] } }, rewards: { $sum: "$rewardEarnedCents" }, n: { $sum: 1 } } },
      ])
      .toArray(),
    c.wishlist.countDocuments({ userId, status: "watching" }),
  ]);
  return { savedCents: agg?.saved ?? 0, rewardsEarnedCents: agg?.rewards ?? 0, purchases: agg?.n ?? 0, activeWatches };
}
