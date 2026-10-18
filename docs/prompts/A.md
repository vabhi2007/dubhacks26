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

## Tasks in priority order (you unblock everyone — data first)
1. **Seed (`scripts/seed.ts`)** — Faker-based, deterministic seed. Personas `u_maya` (+2 backups); 12 months of transactions (~1.5k rows; cafés ≈ $640/yr, groceries, Target, Amazon, subscriptions, phone bill, rideshare); merchants; ~200 mock products (freeze hero products: Breville Bambino BES450 and an iPhone); 90-day price history with realistic dips; 3 Visa cards + ~20 card offers; ~15 rewards programs; 2 mandates (see fixtures); T-Mobile devices / trade-in curves / plans. `pnpm seed` must be idempotent (wipe + reseed `alfred` db only).
2. **Indexes (`scripts/indexes.ts`)** — Voyage embeddings (`VOYAGE_BASE_URL`) for products + rewards; Atlas Search index on products (fuzzy title/brand/model) and Vector Search on products + rewards_programs. M0 allows ~3 search indexes total — verify and fall back if needed.
3. **Core routes on Mongo** — `/profile` (aggregations: spend by category/month, recurring merchants, 12-mo totals), `/stats`, `/mandates` (+ create, revoke), `/approvals` (list, resolve), `/admin/price-drop` (writes price_history + emits `price_drop`), `/admin/advance-time`, `/admin/reset` (reseed).
4. **`purchase()`** in `core/` — uses `authorize()` + a multi-document transaction (order + mandate spend + `purchase` event); on decline emit `mandate_declined` and create an approval instead. Export it for Workstream B's `purchase` tool.
5. **Live updates** — verify change streams → `/events` SSE end to end; approvals listener → Messenger.
6. **Photon iMessage (`messenger/`)** — implement `photonMessenger` with `spectrum-ts` (creds `PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET`; inbound via the `app.messages` stream — confirm whether a webhook/tunnel is needed at all). Inbound text → orchestrator entry point (coordinate the function name with B); inbound photo → `/snap`; `YES A7` / `NO A7` → resolve approval. Only text **my** number while testing. Keep `MESSENGER=console` as default.
7. **VEYZL** — connect the GitHub repo, make sure the audit runs on PRs, and capture one real finding on the purchase/guardrail code → fix → passing check (screenshots for the track).
8. *Stretch:* Photon Voice outbound approval call (DESIGN.md S1) — only after everything above is merged.

## How to work
- One branch per task off fresh `origin/main`: `ws-a/<task>` (e.g. `ws-a/seed-data`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `chore(scripts): seed 12mo transactions for u_maya`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~2 hours.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: tell me before every `pnpm seed`, `pnpm indexes`, or `/admin/reset` so I can warn the group.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

Start with the setup check, then propose your plan for task 1 in ≤10 bullets and begin.
