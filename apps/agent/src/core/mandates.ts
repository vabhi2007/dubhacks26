// Owner: A. The ONLY way money moves (DESIGN.md §8.2). Guardrails live here in code, never in prompts.
import { collections } from "@alfred/shared/db";
import type { Category, Mandate } from "@alfred/shared";

export async function authorize(
  mandateId: string,
  amountCents: number,
  merchantId: string,
  category: Category,
): Promise<Mandate | null> {
  const c = await collections();
  return c.mandates.findOneAndUpdate(
    {
      _id: mandateId,
      status: "active",
      expiresAt: { $gt: new Date() },
      $expr: { $lte: [{ $add: ["$spentCents", amountCents] }, "$capCents"] },
      $or: [{ categories: category }, { merchants: merchantId }],
    },
    { $inc: { spentCents: amountCents } },
    { returnDocument: "after" },
  );
}
