import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const Env = z.object({
  MONGODB_URI: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  SERPAPI_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_BASE_URL: z.string().default("https://ai.mongodb.com/v1"),
  PERCEPTRON_API_KEY: z.string().optional(),
  PERCEPTRON_BASE_URL: z.string().optional(),
  PHOTON_PROJECT_SECRET: z.string().optional(),
  PHOTON_PROJECT_ID: z.string().optional(),
  PUBLIC_TUNNEL_URL: z.string().optional(),
  PRICE_SOURCE: z.enum(["live", "cache", "mock"]).default("mock"),
  VISION_SOURCE: z.enum(["perceptron", "claude", "mock"]).default("claude"),
  MESSENGER: z.enum(["photon", "console"]).default("console"),
  AGENT_PORT: z.coerce.number().default(8787),
  DEMO_USER_ID: z.string().default("u_maya"),
});

export const env = Env.parse(process.env);
