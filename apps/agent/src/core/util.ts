// Owner: A. Small helpers shared by core/.
import { fmtUSD } from "@alfred/shared";
import { MongoServerError } from "@alfred/shared/db";
import { HTTPException } from "hono/http-exception";

/** "$149" for whole dollars, "$4.47" otherwise — for feed/iMessage copy. */
export const usd = (cents: number) => fmtUSD(cents).replace(/\.00$/, "");

export const isDuplicateKey = (e: unknown) => e instanceof MongoServerError && e.code === 11000;

/** Every by-id lookup goes through this: a missing id must never reach a Mongo filter. */
export function requireId(id: unknown, what: string): string {
  if (typeof id !== "string" || !id) throw new HTTPException(400, { message: `${what} is required` });
  return id;
}

/** Insert option: omit `undefined` optional fields instead of storing null (Zod `.optional()` rejects null). */
export const OMIT_UNDEFINED = { ignoreUndefined: true } as const;
