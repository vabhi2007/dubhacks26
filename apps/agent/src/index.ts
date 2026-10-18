import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { APP_NAME } from "@alfred/shared";
import { env } from "./env";
import { core } from "./routes/core";
import { agents } from "./routes/agents";
import { snap } from "./routes/snap";
import { startChangeStreams } from "./core/changeStreams";
import { startMessaging } from "./messenger";

// Binding to 127.0.0.1 doesn't stop the user's own browser from calling us, so:
//  - Host must be this machine (blocks DNS rebinding). Anything else — e.g. a tunnel — may only reach /webhooks/photon (DESIGN.md §12).
//  - CORS reflects only the dashboard and extension origins (CORS_ORIGINS adds more, comma-separated).
//  - Writes must be application/json, which forces a preflight, so other sites can't send "simple" cross-origin POSTs.
const LOCAL_HOSTS = new Set([`127.0.0.1:${env.AGENT_PORT}`, `localhost:${env.AGENT_PORT}`]);
const ORIGINS = new Set(["http://localhost:3100", "http://127.0.0.1:3100", ...(process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
const allowedOrigin = (o: string) => ORIGINS.has(o) || o.startsWith("chrome-extension://"); // unpacked extension ids differ per machine

const app = new Hono();
app.use(logger());
app.use(async (c, next) => {
  if (!LOCAL_HOSTS.has(c.req.header("host") ?? "") && c.req.path !== "/webhooks/photon") return c.json({ error: "forbidden host" }, 403);
  await next();
});
app.use(cors({ origin: (o) => (allowedOrigin(o) ? o : null) }));
app.use(async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !c.req.header("content-type")?.toLowerCase().startsWith("application/json"))
    return c.json({ error: "content-type must be application/json" }, 415);
  await next();
});
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err.name === "ZodError") return c.json({ error: err.message }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "invalid JSON body" }, 400);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.get("/health", (c) => c.json({ ok: true, app: APP_NAME, priceSource: env.PRICE_SOURCE, vision: env.VISION_SOURCE, messenger: env.MESSENGER }));
app.route("/", core);
app.route("/", agents);
app.route("/", snap);

// Indexes are A's job (`pnpm --filter @alfred/scripts setup-db`), not every teammate's boot.
if (env.MONGODB_URI) {
  startChangeStreams().catch((e) => console.error("change streams failed:", e.message));
  startMessaging();
} else console.warn("MONGODB_URI not set — running on fixtures only");

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: env.AGENT_PORT }, (i) =>
  console.log(`${APP_NAME} agent on http://127.0.0.1:${i.port}`),
);
