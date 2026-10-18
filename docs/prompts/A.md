# Workstream A — Platform, Data & Messaging

Run `claude` from the repo root (`dubhacks26/`), then paste everything below the line.

---

You are building **Alfred** with a team of 4 at DubHacks '26. You own **Workstream A — Platform, Data & Messaging**.

## Read first (in this order)
1. `CLAUDE.md` — repo rules and commands.
2. `docs/DESIGN.md` — the whole spec. Your workstream is §9 "A"; contracts are §8 (frozen).
3. `docs/CONTRIBUTING.md` — git workflow. Follow it exactly.

## Setup check (do this before writing code)
- `pnpm install`, then `pnpm check:env` — tell me any ❌ row and stop if a key you need is missing.
- `git fetch origin && git status` — you should be on a clean `main` that matches `origin/main`.
- `pnpm dev` boots (agent :8787, web :3100, extension WXT :3110). Stop it when done checking.

## Your scope
**You may edit:** `packages/shared/` (contracts via contracts PRs only), `scripts/`, `apps/agent/src/core/`, `apps/agent/src/messenger/`, `apps/agent/src/routes/core.ts`, `apps/agent/src/index.ts` (route wiring), `.env.example`, Atlas setup, VEYZL setup.
**Do not edit:** anything else. Consume other workstreams only through `@alfred/shared` types, fixtures, and the HTTP routes in DESIGN.md §8.3. If a teammate's piece isn't ready, use its mock/fixture and keep going.
**Contracts:** if you truly need a change to `packages/shared/src/schemas.ts` / `interfaces.ts`, stop and tell me first; it goes in its own `contracts/<change>` branch + PR, separate from feature work.

## Tasks — MVP-first (DESIGN.md §10). Finish and merge each tier before starting the next.
You unblock everyone: ship a **minimal** seed fast, then grow it.

**MVP-0 — core loop (target: first PR in ~30 min, tier done in ~3h)**
1. **Minimal seed (`scripts/seed.ts`)** — deterministic, idempotent (wipe + reseed `alfred` db). Only what the loop needs: `u_maya`; 12 months of transactions (cafés ≈ $640/yr plus a few other categories); 3 Visa cards; 2 mandates (see fixtures); hero products Breville Bambino BES450 + an iPhone with offers and 90-day price history with dips. → PR `ws-a/seed-mvp0`.
2. **Core routes on Mongo** — `/stats`, `/mandates` (list, revoke), `/approvals` (list, resolve → `purchase()`), `/admin/price-drop` (writes price_history + emits `price_drop`), `/admin/reset` (reseed).
3. **`purchase()`** in `core/` — `authorize()` + multi-document transaction (order + mandate spend + `purchase` event); decline → emit `mandate_declined` + create approval. Export it for B.
4. **Live updates** — change streams → `/events` SSE verified end to end; approvals listener → console Messenger.

**MVP-1 — real inputs & iMessage**
5. **Seed expansion** — ~200 products, 2 backup personas, rewards programs, card offers, T-Mobile devices / trade-in curves / plans.
6. **Indexes (`scripts/indexes.ts`)** — Voyage embeddings (`VOYAGE_BASE_URL`); Atlas Search on products; Vector Search on products + rewards_programs (M0 ≈ 3 search indexes — verify).
7. **Photon iMessage (`messenger/`)** — `photonMessenger` with `spectrum-ts` (`PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET`); inbound via the `app.messages` stream — **prefer this; it needs no tunnel**. Only if webhooks turn out to be required: follow DESIGN.md §12 and tell me before starting a tunnel. Inbound text → B's orchestrator entry point; photo → `/snap`; `YES A7` / `NO A7` → resolve approval. Only text **my** number while testing. Default stays `MESSENGER=console`.

**MVP-2 / MVP-3**
8. `/profile` aggregations (spend by category/month, recurring merchants), `/mandates` create, `/admin/advance-time`.
9. **VEYZL** — confirm the audit runs on PRs; capture one real finding on purchase/guardrail code → fix → passing check (screenshots).
10. *Stretch:* Photon Voice outbound approval call (DESIGN.md S1).

## How to work
- One branch per task off fresh `origin/main`: `ws-a/<task>` (e.g. `ws-a/seed-mvp0`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `chore(scripts): seed 12mo transactions for u_maya`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~1–2 hours. **MVP-first:** a thin PR that keeps the whole loop working beats a complete one that doesn't integrate.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: tell me before every `pnpm seed`, `pnpm indexes`, or `/admin/reset` so I can warn the group.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

After a PR is open, don't wait for me — start the next task on a new branch off fresh `origin/main` (still stop for the ask-first items above).

Start with the setup check, then propose your plan for **MVP-0** in ≤10 bullets and begin.
