// Owner: C. Snap & Find (DESIGN.md §8.3): image → vision → product → offers → Worth-It verdict.
import { Hono } from "hono";
import { fmtUSD, SnapRequest, SnapResponse } from "@alfred/shared";
import { env } from "../env";
import { emit } from "../core/events";
import { resolveProduct, vision } from "../vision";
import { findOffers, getVerdict, rankOffers } from "../deal";

export const snap = new Hono();

snap.post("/snap", async (c) => {
  const req = SnapRequest.parse(await c.req.json());
  const img = Uint8Array.from(Buffer.from(req.image.replace(/^data:[^,]*,/, ""), "base64"));
  const userId = env.DEMO_USER_ID;

  const t0 = Date.now();
  const detection = await vision.detect(img);
  const product = await resolveProduct(detection);
  const offers = rankOffers(await findOffers(product));
  const verdict = await getVerdict({ userId, product, offers, surface: req.source });
  console.log(`snap: ${product._id} · ${offers.length} offers · ${verdict.kind} · ${Date.now() - t0}ms`);

  if (env.MONGODB_URI) {
    const best = offers.find((o) => o.condition === "new");
    emit({
      userId,
      agent: "vision",
      surface: req.source,
      type: "snap",
      summary: `Identified ${product.title}${best ? ` — best new ${fmtUSD(best.priceCents)} at ${best.seller}` : ""}`,
      refs: { productId: product._id, verdictId: verdict._id },
    }).catch((e) => console.warn("snap: emit failed:", e.message));
  }

  return c.json(SnapResponse.parse({ product, offers, similar: [], verdict }));
});
