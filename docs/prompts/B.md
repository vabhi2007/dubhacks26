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

## Tasks — MVP-first (DESIGN.md §10). Finish and merge each tier before starting the next.
Use the shared client in `apps/agent/src/agents/index.ts` (it already sends the workspace header). Models: `claude-opus-5-5` for orchestration and verdicts, `claude-haiku-5-5` for cheap classification. Use **structured outputs** for every `Verdict`, and the Anthropic TS SDK **Tool Runner** (`client.beta.messages.toolRunner` + `betaZodTool`) for the orchestrator. Check current SDK docs/types rather than relying on memory.

**MVP-0 — core loop (target: first PR in ~45 min)**
1. **Worth-It** — export `worthIt({ userId, productId, offers })` → `Verdict` (`buy`/`wait`/`skip`, 2–4 concrete reasons, `math`: payback months vs related category spend, budget impact, expected drop from price history). Willing to say Wait/Skip. Persist to `verdicts`, `emit()` a `verdict` event. Query Mongo directly; fall back to fixtures until A's seed is on `main`. C's `/snap` calls this function. → PR `ws-b/worth-it`.
2. **Watch + Watcher** — `/wishlist` GET/POST real; on `price_drop` events: if the new price ≤ target, check mandate + confirm threshold → buy via A's `purchase()` (never bypass `authorize()`) or create an approval.
3. `/verdicts/:id` real.

**MVP-1 — conversational agent**
4. **Orchestrator** — Tool Runner with tools `snap_find`, `worth_it`, `deal_search`, `create_watch`, `request_approval`, `purchase` (add `timekeeper`, `rewards_scan`, `smart_pay` in MVP-2). Conversation memory in `conversations`, shared across surfaces. Export `handleUserMessage({ userId, text, surface, imageUrls })` for A's iMessage handler (confirm the name with A).
5. **`/chat`** — real streaming (SSE `{delta}` … `{done, verdictId?}`).

**MVP-2 — breadth**
6. **Timekeeper (T-Mobile)** — "upgrade now vs wait N months" from device age, financing, trade-in curve, battery/storage → `Verdict` with `mode: "timekeeper"` + `tradeInSeries`; `/timekeeper` real.
7. **Rewards Optimizer + Smart Pay** — rank programs by est. $/yr from merchant spend (Vector Search on `rewards_programs` once A's index exists), simulated enroll; Smart Pay picks the max-reward card/offer. `/rewards` real.

**MVP-3** — prompt quality pass: headlines ≤ 90 chars, numbers in every reason, no hedging boilerplate.

## How to work
- One branch per task off fresh `origin/main`: `ws-b/<task>` (e.g. `ws-b/worth-it`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `feat(agent): worth-it verdict with payback math`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~1–2 hours. **MVP-first:** a thin PR that keeps the whole loop working beats a complete one that doesn't integrate.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: **never run `pnpm seed`, `pnpm indexes`, `/admin/reset`, or drop anything** — that's Workstream A's job. Read/write through normal routes only.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

After a PR is open, don't wait for me — start the next task on a new branch off fresh `origin/main` (still stop for the ask-first items above).

Start with the setup check, then propose your plan for **MVP-0** in ≤10 bullets and begin.
