# Workstream C — Vision, Deals & Extension

Run `claude` from the repo root (`dubhacks26/`), then paste everything below the line.

---

You are building **Alfred** with a team of 4 at DubHacks '26. You own **Workstream C — Vision, Deals & Extension**.

## Read first (in this order)
1. `CLAUDE.md` — repo rules and commands.
2. `docs/DESIGN.md` — the whole spec. Your workstream is §9 "C"; contracts are §8 (frozen).
3. `docs/CONTRIBUTING.md` — git workflow. Follow it exactly.

## Setup check (do this before writing code)
- `pnpm install`, then `pnpm check:env` — tell me any ❌ row and stop if a key you need is missing.
- `git fetch origin && git status` — you should be on a clean `main` that matches `origin/main`.
- `pnpm dev` boots (agent :8787, web :3100, extension WXT :3110). Stop it when done checking.

## Your scope
**You may edit:** `apps/agent/src/vision/`, `apps/agent/src/deal/`, `apps/agent/src/routes/snap.ts`, `apps/extension/`.
**Do not edit:** anything else. Consume other workstreams only through `@alfred/shared` types, fixtures, and the HTTP routes in DESIGN.md §8.3. If a teammate's piece isn't ready, use its mock/fixture and keep going.
**Contracts:** if you truly need a change to `packages/shared/src/schemas.ts` / `interfaces.ts`, stop and tell me first; it goes in its own `contracts/<change>` branch + PR, separate from feature work.

## Tasks — MVP-first (DESIGN.md §10). Finish and merge each tier before starting the next.

**MVP-0 — core loop (target: first PR in ~45 min)**
1. **`/snap` wired end to end on mocks** — mock `Vision` (current stub) → resolve to a hero product (simple text match on `products`, fixture until A's seed lands) → offers from `PRICE_SOURCE=mock|cache` → B's `worthIt()` (use the fixture verdict until B's PR merges, behind one function so swapping is one line) → `SnapResponse`; `emit()` a `snap` event. → PR `ws-c/snap-mvp0`.
2. **Extension side panel** — show product, verdict (headline, reasons, price), offers, and a **Watch** button (`POST /wishlist`). Use D's `@alfred/ui` components when they land; until then small local components with the same tokens. Keep the existing Alt+Shift+S full-tab capture.

**MVP-1 — real inputs**
3. **Perceptron `Vision`** — `POST {PERCEPTRON_BASE_URL}/chat/completions`, Bearer auth, model `perceptron-mk1.5`, image as base64 data URL in `image_url`. Prompt for localization + OCR (brand, model number, price tag) → `{objects, ocr, caption}`. Claude-vision fallback on error or `VISION_SOURCE=claude`. Measure latency.
4. **Product resolution** — OCR → Atlas Search fuzzy match (A's index; regex until it exists) → `claude-opus-5-5` picks the exact model or creates a product.
5. **SerpAPI `PriceSource`** — `google_shopping`, `gl=us`; cache in Mongo and check cache first (quota ~247/month — use `mock` while developing, never call it in loops/tests). Label with `claude-haiku-5-5` (exact/variant/different, new/used/refurb, region); rank best new US exact first, used/refurb as a separate group.

**MVP-2 — breadth**
6. Region-select overlay before capture; video-frame snap on a paused YouTube video; similar items via Vector Search; live `/events` in the side panel.

**MVP-3** — edge cases: blurry photo, multiple objects, unknown product, quota/timeout → cache/mock.

## How to work
- One branch per task off fresh `origin/main`: `ws-c/<task>` (e.g. `ws-c/snap-mvp0`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `feat(agent): perceptron vision with claude fallback`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~1–2 hours. **MVP-first:** a thin PR that keeps the whole loop working beats a complete one that doesn't integrate.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: **never run `pnpm seed`, `pnpm indexes`, `/admin/reset`, or drop anything** — that's Workstream A's job. Read/write through normal routes only.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

After a PR is open, don't wait for me — start the next task on a new branch off fresh `origin/main` (still stop for the ask-first items above).

Start with the setup check, then propose your plan for **MVP-0** in ≤10 bullets and begin.
