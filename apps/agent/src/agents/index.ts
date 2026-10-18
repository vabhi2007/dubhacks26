// Owner: B. Orchestrator (Anthropic TS SDK Tool Runner) + sub-agents: worth_it, timekeeper, rewards, smart_pay, watcher.
// Models: claude-opus-5-5 for reasoning/verdicts, claude-haiku-5-5 for bulk classification. Structured outputs for every Verdict.

// Shared client. Set ANTHROPIC_WORKSPACE_ID only if the key isn't workspace-scoped.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";

export const anthropic = new Anthropic(
  env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } } : {},
);
