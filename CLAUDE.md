# Alfred — agent instructions

**Read `docs/DESIGN.md` first.** It is the single source of truth for features, architecture, design system, contracts, and workstream ownership.

## Your workstream
Your human will tell you which workstream you own (A, B, C, or D — DESIGN.md §9). If they haven't, ask before writing code.
- Edit only the paths your workstream owns. Consume other workstreams only through `@alfred/shared` types and the HTTP routes in DESIGN.md §8.3.
- **Contracts are frozen** (`packages/shared/src/schemas.ts`, `interfaces.ts`, DESIGN.md §8). If you need a change, make it a small, separate PR touching only `packages/shared` + DESIGN.md, and tell your human so all owners see it.
- Every external integration has a mock behind a flag (`PRICE_SOURCE`, `VISION_SOURCE`, `MESSENGER`). Keep the mock path working — teammates depend on it.

## Layout
```
apps/agent        Hono service :8787   core/ + messenger/ (A) · agents/ (B) · vision/ + deal/ (C) · routes/{core,agents,snap}.ts
apps/web          Next.js :3100        dashboard + /admin (D). Read apps/web/AGENTS.md — this Next.js version differs from training data.
apps/extension    WXT (Chrome MV3)     side panel + snap (C)
packages/shared   zod contracts, db client, fixtures, interfaces (A owns; all PR)
packages/ui       tokens.css, motion presets, shared components (D)
scripts/          check-env, setup-db, seed, indexes (A)
```

## Commands (repo root)
```
pnpm install
pnpm check:env                       # verifies every key in .env actually works
pnpm --filter @alfred/scripts setup-db
pnpm seed && pnpm indexes
pnpm dev                             # agent :8787, web :3100, extension (WXT dev)
pnpm typecheck
pnpm --filter @alfred/agent dev      # run one app
```
Load the extension: `pnpm --filter @alfred/extension build`, then chrome://extensions → Load unpacked → `apps/extension/.output/chrome-mv3`.

## Conventions
- TypeScript everywhere, ESM, Node ≥ 22. Validate every request body with the shared Zod schema.
- Money is integer **cents**; format with `fmtUSD`. Ids are prefixed strings via `newId("prd")`.
- Single `.env` at repo root (never commit it; `.env.example` lists everything). Browser code only sees `NEXT_PUBLIC_*` / `WXT_*`.
- Agent service binds to 127.0.0.1 only; Photon reaches it through the cloudflared tunnel to `/webhooks/photon`.
- Money moves **only** through `authorize()` in `apps/agent/src/core/mandates.ts` — never let a prompt bypass it.
- Anything user-visible the agent does → `emit()` an AgentEvent (`apps/agent/src/core/events.ts`).
- Claude: `claude-opus-5-5` for reasoning/verdicts, `claude-haiku-5-5` for bulk classification. Anthropic TS SDK Tool Runner; structured outputs for every Verdict.
- UI: use tokens from `@alfred/ui/tokens.css` (`bg-surface`, `text-accent`, `rounded-card`, `.num` for money). Motion only on state change, 150–250ms, respect reduced motion (DESIGN.md §6).
- Small commits, one branch per workstream (`ws-a/...`, `ws-b/...`), PR into `main`.
