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

## Tasks in priority order
Design bar: premium fintech (Linear / Mercury / Ramp / Arc), dark-first, deep "tough" gold accent from `packages/ui/src/tokens.css` (never neon), Geist + Geist Mono for money, motion **only on state change** (150–250ms, springs for layout, respect `prefers-reduced-motion`). DESIGN.md §6 is the spec.
1. **Shared components (`packages/ui`)** — build against `@alfred/shared/fixtures` first so C can reuse them in the extension: `VerdictCard`, `ApprovalCard` (morphs into `Receipt` on approve), `OfferRow`, `MandateCard` (cap progress + revoke), `FeedItem`, `MoneyStat` (number ticker), `RewardCard`, `TimekeeperChart` (Recharts), `ChatPanel` (streaming), `AgentBadge`, `SurfaceBadge`. Add shadcn/ui primitives inside `packages/ui` as needed.
2. **App shell** — sidebar nav, header with savings counter, dark/light toggle, toasts (Sonner), live `/events` SSE hook that feeds the Agent Feed and pending approvals everywhere.
3. **Pages** — Home (savings, latest verdicts, pending approvals), Feed, Spending Profile (Recharts from `/profile`; one embedded Atlas Chart if `ATLAS_CHARTS_*` is set), Wishlist/Watcher, Mandates, Rewards, Timekeeper, Chat. Use `apps/web/src/lib/api.ts`; fall back to fixtures when a route returns 501.
4. **`/admin` demo control** — price drop, advance time, reset persona, show current flags; big obvious buttons, hidden from main nav.
5. **Cloudforce Side Kick (F9)** — a standalone 3-question "Spending Personality" agent built in Cloudforce's Purple platform (outside this repo); post it on LinkedIn tagging @Cloudforce and @University of Washington early so engagement builds. Ask me before posting.
6. **Pitch** — `docs/pitch/`: 3-minute demo script (DESIGN.md §11), slide outline, Devpost write-up draft, SideShift startup angle (creator-video → affiliate distribution). Record the demo video near the end.
7. Polish pass: empty/loading/error states, skeletons for verdicts, keyboard focus states, reduced motion.

## How to work
- One branch per task off fresh `origin/main`: `ws-d/<task>` (e.g. `ws-d/verdict-card`). Rebase on `origin/main` before each PR.
- Commit small and often with conventional messages scoped to your area (e.g. `feat(ui): VerdictCard with buy/wait/skip states`). Run `pnpm typecheck` before every commit. Stage specific files; never commit `.env` or any key.
- After each task: push the branch and open a PR into `main` with what changed, how to test, screenshots if UI. **Don't merge it yourself — tell me it's ready.** Aim for a mergeable PR every ~2 hours.
- Keep every mock path working (`PRICE_SOURCE=mock`, `VISION_SOURCE`, `MESSENGER=console`) — teammates and the demo depend on it.
- The Atlas db is shared by all 4 teammates: **never run `pnpm seed`, `pnpm indexes`, `/admin/reset`, or drop anything** — that's Workstream A's job. Read/write through normal routes only.
- Ask me before: changing contracts, adding a new external service or paid API, sending real iMessages to anyone other than me, or anything destructive (dropping collections, force-pushing).
- When you finish a milestone, give me a 3-line status: done, next, blocked-on.

Start with the setup check, then propose your plan for task 1 in ≤10 bullets and begin.
