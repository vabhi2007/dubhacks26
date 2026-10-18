// Shared Anthropic client. Set ANTHROPIC_WORKSPACE_ID only if the key isn't workspace-scoped.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";

export const anthropic = new Anthropic(
  env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } } : {},
);
