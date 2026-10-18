// Owner: C. Snap & Find (DESIGN.md §8.3): image → vision → product → offers → Worth-It verdict.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { fmtUSD, SnapRequest, SnapResponse } from "@alfred/shared";
import { env } from "../env";
import { emit } from "../core/events";
import { NEW_PRODUCT_PREFIX, resolveProduct, sniffMime, vision } from "../vision";
import { heicToJpeg, isHeic } from "../vision/heic";
import { findSimilar, getVerdict, priceProduct, rankOffers } from "../deal";

export const snap = new Hono();

const MAX_BODY_BYTES = 15 * 1024 * 1024; // the extension sends a downscaled JPEG; iMessage photos fit too
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

snap.post(
  "/snap",
  bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "image too large (max 15 MB)" }, 413) }),
  async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "body must be JSON" }, 400);
    const req = SnapRequest.parse(body);
    const b64 = req.image.replace(/^data:[^,]*,/, "").replace(/\s/g, "");
    if (!BASE64.test(b64)) return c.json({ error: "image must be non-empty base64 (or a base64 data URL)" }, 400);
    let img: Uint8Array = Buffer.from(b64, "base64");
    if (isHeic(img)) {
      const t = Date.now();
      try {
        img = await heicToJpeg(img);
        console.log(`snap: converted HEIC → JPEG (${Math.round(img.length / 1024)} KB) in ${Date.now() - t}ms`);
      } catch (e) {
        return c.json({ error: `couldn't read this HEIF/AVIF photo: ${(e as Error).message}` }, 400);
      }
    }
    if (!sniffMime(img)) return c.json({ error: "image must be PNG, JPEG, WebP, GIF or HEIC" }, 400);
    const userId = env.DEMO_USER_ID;

    const t0 = Date.now();
    const detection = await vision.detect(img);
    const tVision = Date.now() - t0;
    const { product: resolved, identified, via } = await resolveProduct(detection, img);
    const tResolve = Date.now() - t0 - tVision;
    const priced = await priceProduct(resolved);
    const product = priced.product; // a product Claude named may have just been saved with live prices
    const offers = rankOffers(priced.offers);
    const inCatalog = identified && !product._id.startsWith(NEW_PRODUCT_PREFIX);
    // Similar items don't depend on the verdict: look them up while Worth-It thinks.
    const [{ verdict, saved }, similar] = await Promise.all([getVerdict({ userId, product, offers, surface: req.source }), findSimilar(product)]);
    console.log(`snap: ${product._id} · ${offers.length} offers · ${similar.length} similar · ${verdict.kind}${saved ? "" : " (neutral)"} · vision ${tVision}ms · resolve ${tResolve}ms (${via}) · total ${Date.now() - t0}ms`);

    if (env.MONGODB_URI) {
      const best = offers.find((o) => o._id === verdict.math.bestOfferId);
      emit({
        userId,
        agent: "vision",
        surface: req.source,
        type: "snap",
        summary: !identified
          ? `Couldn't identify the product in your snap (best guess: ${product.title})`
          : !inCatalog
            ? `Identified ${product.title} — not in the catalog yet, no prices`
            : `Identified ${product.title}${best ? ` — best ${best.condition} ${fmtUSD(best.priceCents)} at ${best.seller}` : ""}`,
        refs: inCatalog ? { productId: product._id, ...(saved && { verdictId: verdict._id }) } : {},
      }).catch((e) => console.warn("snap: emit failed:", e.message));
    }

    // Product/offer rows are validated where they're read; a failure here is our bug, not the client's.
    const res = SnapResponse.safeParse({ product, offers, similar, verdict });
    if (!res.success) {
      console.error("snap: invalid response:", res.error.message);
      return c.json({ error: "snap produced an invalid response" }, 500);
    }
    return c.json(res.data);
  },
);
