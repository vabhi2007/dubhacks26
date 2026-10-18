import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { APP_NAME } from "@alfred/shared";
import { getDb } from "@alfred/shared/db";
import { ensureSchema } from "@alfred/shared/seed";
import { env } from "./env";
import { core } from "./routes/core";
import { agents } from "./routes/agents";
import { snap } from "./routes/snap";
import { startChangeStreams } from "./core/changeStreams";

const app = new Hono();
app.use(logger());
app.use(cors({ origin: (o) => o ?? "*" })); // local only: web (:3100) + chrome-extension://
app.onError((err, c) =>
  err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.json({ error: err.message }, err.name === "ZodError" ? 400 : 500),
);

app.get("/health", (c) => c.json({ ok: true, app: APP_NAME, priceSource: env.PRICE_SOURCE, vision: env.VISION_SOURCE, messenger: env.MESSENGER }));
app.route("/", core);
app.route("/", agents);
app.route("/", snap);

if (env.MONGODB_URI) {
  getDb()
    .then(ensureSchema) // idempotent: collections + indexes the core relies on
    .then(startChangeStreams)
    .catch((e) => console.error("db boot failed:", e.message));
} else {
  console.warn("MONGODB_URI not set — running on fixtures only");
}

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: env.AGENT_PORT }, (i) =>
  console.log(`${APP_NAME} agent on http://127.0.0.1:${i.port}`),
);
