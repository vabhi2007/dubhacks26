# Workstream B — Agent Brain

Run `claude` from the repo root (`dubhacks26/`), then paste everything below the line.

---

You are building **Alfred** with a team of 4 at DubHacks '26. You own **Workstream B — Agent Brain**.

## Read first (in this order)
1. `CLAUDE.md` — repo rules and commands.
2. `docs/DESIGN.md` — the whole spec. Your workstream is §9 "B"; contracts are §8 (frozen).
3. `docs/CONTRIBUTING.md` — git workflow. Follow it exactly.

## Setup check (do this before writing code)
- `pnpm install`, then `pnpm check:env` — tell me any ❌ row and stop if a key you need is missing.
- `git fetch origin && git status` — you should be on a clean `main` that matches `origin/main`.
- `pnpm dev` boots (agent :8787, web :3100, extension WXT :3110). Stop it when done checking.

## Your scope
**You may edit:** `apps/agent/src/agents/`, `apps/agent/src/routes/agents.ts`.
**Do not edit:** anything else. Consume other workstreams only through `@alfred/shared` types, fixtures, and the HTTP routes in DESIGN.md §8.3. If a teammate's piece isn't ready, use its mock/fixture and keep going.
**Contracts:** if you truly need a change to `packages/shared/src/schemas.ts` / `interfaces.ts`, stop and tell me first; it goes in its own `contracts/<change>` branch + PR, separate from feature work.

## Tasks in priority order
Use the shared client in `apps/agent/src/agents/index.ts` (it already sends the workspace header). Models: `claude-opus-5-5` for orchestration and verdicts, `claude-haiku-5-5` for cheap classification. Use the Anthropic TS SDK **Tool Runner** (`client.beta.messages.toolRunner` + `betaZodTool`) and **structured outputs** for every `Verdict`. Before writing SDK code, check the current SDK docs/types rather than relying on memory.
1. **Worth-It agent** — given a product + offers + `u_maya`'s history (query Mongo directly; until A's seed lands, use fixtures), produce a `Verdict` (`buy`/`wait`/`skip`) with 2–4 plain-language reasons and the `math` block (payback months vs related category spend, budget impact, expected drop from price history). It must be willing to say Wait/Skip. Persist to `verdicts`, `emit()` a `verdict` event.
2. **Orchestrator** — Tool Runner with tools: `snap_find` (calls C's pipeline; mock until ready), `worth_it`, `timekeeper`, `deal_search`, `create_watch`, `rewards_scan`, `smart_pay`, `request_approval`, `purchase` (calls A's `purchase()`; never bypass `authorize()`). Conversation memory from `conversations` shared across surfaces. Export a single entry point (e.g. `handleUserMessage({userId, text, surface, imageUrls})`) for A's Messenger — agree the name with A.
3. **`/chat`** — real streaming (SSE `{delta}` … `{done, verdictId?}`), replacing the stub.
4. **Watcher** — on `price_drop` events: check wishlist targets, budget and mandate; if within mandate and under confirm threshold buy, else `request_approval`. `/wishlist` GET/POST real.
5. **Timekeeper (T-Mobile)** — "upgrade now vs wait N months" from device age, financing remaining, trade-in curve, battery/storage; returns `Verdict` with `mode: "timekeeper"` and `tradeInSeries`. `/timekeeper` real.
6. **Rewards Optimizer + Smart Pay** — rank rewards programs by estimated $/yr from merchant spend (Vector Search on `rewards_programs` once A's index exists), simulated enroll; Smart Pay picks the card/offer with max reward for a purchase. `/rewards` real.
7. Prompt quality pass: verdict headlines ≤ 90 chars, reasons concrete with numbers, no hedging boilerplate.

## How to work
- One branch per task off fresh `origin/main`: `ws-b/<task>` (e.g. `ws-b/worth-it`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `feat(agent): worth-it verdict with payback math`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~2 hours.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: **never run `pnpm seed`, `pnpm indexes`, `/admin/reset`, or drop anything** — that's Workstream A's job. Read/write through normal routes only.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

Start with the setup check, then propose your plan for task 1 in ≤10 bullets and begin.
