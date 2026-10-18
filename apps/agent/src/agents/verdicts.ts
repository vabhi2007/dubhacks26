// Owner: B. Publishing a verdict, shared by Worth-It and Timekeeper.
import { collections } from "@alfred/shared/db";
import type { AgentName, Surface, Verdict } from "@alfred/shared";
import { emit } from "../core/events";
import { hasDb, rememberVerdict } from "./data";

export const kindLabel = (k: Verdict["kind"]) => ({ buy: "Buy", wait: "Wait", skip: "Skip" })[k];

/** Remember in-process, then persist + emit in the background: the verdict is already paid for, and a slow or
 *  unreachable Atlas must neither fail nor delay it. rememberVerdict keeps /verdicts/:id working meanwhile. */
export function publishVerdict(verdict: Verdict, surface: Surface, agent: AgentName) {
  rememberVerdict(verdict);
  if (!hasDb()) return;
  void (async () => {
    try {
      const c = await collections();
      await c.verdicts.insertOne(verdict);
      await emit({
        userId: verdict.userId,
        agent,
        surface,
        type: "verdict",
        summary: `${kindLabel(verdict.kind)} — ${verdict.headline}`,
        refs: { productId: verdict.productId, verdictId: verdict._id },
      });
    } catch (e) {
      console.warn(`[${agent}] failed to persist verdict/event:`, (e as Error).message);
    }
  })();
}
