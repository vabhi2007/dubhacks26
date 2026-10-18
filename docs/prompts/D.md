# Workstream D — Dashboard, Design System & Pitch

Run `claude` from the repo root (`dubhacks26/`), then paste everything below the line.

---

You are building **Alfred** with a team of 4 at DubHacks '26. You own **Workstream D — Dashboard, Design System & Pitch**.

## Read first (in this order)
1. `CLAUDE.md` — repo rules and commands.
2. `docs/DESIGN.md` — the whole spec. Your workstream is §9 "D"; contracts are §8 (frozen).
3. `docs/CONTRIBUTING.md` — git workflow. Follow it exactly.

## Setup check (do this before writing code)
- `pnpm install`, then `pnpm check:env` — tell me any ❌ row and stop if a key you need is missing.
- `git fetch origin && git status` — you should be on a clean `main` that matches `origin/main`.
- `pnpm dev` boots (agent :8787, web :3100, extension WXT :3110). Stop it when done checking.

## Your scope
**You may edit:** `packages/ui/`, `apps/web/`, pitch/demo assets (`docs/pitch/`). Read `apps/web/AGENTS.md` — this Next.js version differs from your training data; check `node_modules/next/dist/docs/` before using Next APIs.
**Do not edit:** anything else. Consume other workstreams only through `@alfred/shared` types, fixtures, and the HTTP routes in DESIGN.md §8.3. If a teammate's piece isn't ready, use its mock/fixture and keep going.
**Contracts:** if you truly need a change to `packages/shared/src/schemas.ts` / `interfaces.ts`, stop and tell me first; it goes in its own `contracts/<change>` branch + PR, separate from feature work.

## Tasks — MVP-first (DESIGN.md §10). Finish and merge each tier before starting the next.
Design bar: premium fintech (Linear / Mercury / Ramp / Arc), dark-first, deep "tough" gold accent from `packages/ui/src/tokens.css` (never neon), Geist + Geist Mono for money. DESIGN.md §6 is the spec. In MVP-0 keep motion to simple fades; full motion pass is MVP-3.

**MVP-0 — core loop (target: first PR in ~45 min)**
1. **Core components (`packages/ui`)** built against `@alfred/shared/fixtures`: `VerdictCard`, `ApprovalCard` (Approve/Deny), `FeedItem`, `MoneyStat`. Add shadcn/ui primitives inside `packages/ui` as needed. → PR `ws-d/core-components` (C reuses these in the extension).
2. **App shell + Home** — sidebar nav (only Home + Admin live for now), header savings counter, live `/events` SSE hook; Home shows stats, latest verdict, pending approvals (Approve/Deny → `POST /approvals/:id`), Agent Feed. Use `apps/web/src/lib/api.ts`; fall back to fixtures when a route returns 501.
3. **`/admin` demo control** — price drop (hero products), reset persona, current flags. Big obvious buttons, hidden from main nav.

**MVP-1 / MVP-2 — breadth**
4. Components: `OfferRow`, `MandateCard` (cap progress + revoke), `RewardCard`, `TimekeeperChart` (Recharts), `ChatPanel` (streaming), `AgentBadge`, `SurfaceBadge`.
5. Pages: Feed, Chat, Spending Profile (Recharts from `/profile`; one embedded Atlas Chart if `ATLAS_CHARTS_*` is set), Wishlist, Mandates, Rewards, Timekeeper.

**MVP-3 — polish & pitch**
7. Motion pass (ApprovalCard → Receipt morph, feed slide-in, ticker), empty/loading/error states, skeletons, focus states, reduced motion.
8. `docs/pitch/`: 3-min demo script (DESIGN.md §11), slide outline, Devpost draft, SideShift startup angle; record the demo video near the end.

## How to work
- One branch per task off fresh `origin/main`: `ws-d/<task>` (e.g. `ws-d/core-components`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `feat(ui): VerdictCard with buy/wait/skip states`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~1–2 hours. **MVP-first:** a thin PR that keeps the whole loop working beats a complete one that doesn't integrate.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: **never run `pnpm seed`, `pnpm indexes`, `/admin/reset`, or drop anything** — that's Workstream A's job. Read/write through normal routes only.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

After a PR is open, don't wait for me — start the next task on a new branch off fresh `origin/main` (still stop for the ask-first items above).

Start with the setup check, then propose your plan for **MVP-0** in ≤10 bullets and begin.
