// Owner: A. Small helpers shared by core/.
import { fmtUSD } from "@alfred/shared";
import { MongoServerError } from "@alfred/shared/db";

/** "$149" for whole dollars, "$4.47" otherwise — for feed/iMessage copy. */
export const usd = (cents: number) => fmtUSD(cents).replace(/\.00$/, "");

export const isDuplicateKey = (e: unknown) => e instanceof MongoServerError && e.code === 11000;
