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

## Tasks in priority order
1. **Vision (`vision/`)** — `Vision` impl for Perceptron: `POST {PERCEPTRON_BASE_URL}/chat/completions`, Bearer auth, model `perceptron-mk1.5`, image as base64 data URL in `image_url`. Prompt it for object localization + OCR (brand, model number, price tag) and parse into `{objects, ocr, caption}`. Claude-vision fallback when `VISION_SOURCE=claude` or Perceptron errors. Measure latency.
2. **Product resolution** — OCR text → Atlas Search fuzzy match on `products` (A's index; fall back to regex until it exists) → `claude-opus-5-5` picks the exact model (or creates a new product doc from SerpAPI data).
3. **Deal agent (`deal/`)** — `PriceSource` for `PRICE_SOURCE=live|cache|mock`. Live = SerpAPI `google_shopping` (`gl=us`), then cache offers in Mongo; check the cache first (quota: ~247 searches/month — don't burn it in loops or tests; use `mock` while developing). Label each result with `claude-haiku-5-5` (matched exact/variant/different, condition new/used/refurb, region) and rank: best new US exact offer first, used/refurb as a separate labeled group. Similar items via Vector Search.
4. **`/snap`** — real pipeline: vision → resolve → deals → call B's Worth-It (mock until ready) → `SnapResponse`; `emit()` a `snap` event.
5. **Extension** — region-select overlay (content script) before capture; side panel renders the full verdict (use D's `@alfred/ui` components as they land; until then local components with the same tokens), offers list, Watch and Buy actions, and live updates from `/events`. Video-frame snap: works on a paused YouTube video.
6. Edge cases: blurry photo, multiple objects (pick the most prominent, offer alternatives), unknown product, SerpAPI quota/timeout → cache/mock.

## How to work
- One branch per task off fresh `origin/main`: `ws-c/<task>` (e.g. `ws-c/perceptron`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `feat(agent): perceptron vision with claude fallback`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~2 hours.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: **never run `pnpm seed`, `pnpm indexes`, `/admin/reset`, or drop anything** — that's Workstream A's job. Read/write through normal routes only.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

Start with the setup check, then propose your plan for task 1 in ≤10 bullets and begin.
