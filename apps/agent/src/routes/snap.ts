// Owner: C. Snap & Find (DESIGN.md §8.3). Stub returns fixture until vision + deal are live.
import { Hono } from "hono";
import * as fx from "@alfred/shared/fixtures";
import { SnapRequest } from "@alfred/shared";

export const snap = new Hono();

snap.post("/snap", async (c) => {
  SnapRequest.parse(await c.req.json());
  return c.json(fx.snapResponse);
});
