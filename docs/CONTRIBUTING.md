# Git workflow (team repo)

Four people + four coding agents on one repo for ~24h. These rules keep `main` always demo-able.

## Branches
- `main` is protected by convention: **always boots, always typechecks, golden path works on mocks.** Never commit directly to it; never force-push it.
- One short-lived branch per task: `ws-<letter>/<short-task>` — e.g. `ws-a/seed-data`, `ws-b/worth-it`, `ws-c/perceptron`, `ws-d/verdict-card`.
- Contract changes (`packages/shared/src/schemas.ts`, `interfaces.ts`, DESIGN.md §8) go on their own branch `contracts/<change>` with nothing else in it.

## Commits
- Small and frequent. Conventional style with a scope:
  `feat(agent): worth-it verdict with payback math` · `fix(web): feed scroll jump` · `chore(scripts): seed 12mo transactions` · `feat(shared)!: add Verdict.confidence` (`!` = contract change)
- Scopes: `agent`, `web`, `extension`, `shared`, `ui`, `scripts`, `docs`.
- Before every commit: `pnpm typecheck` passes. Stage specific files — never `git add -A` blindly; **never commit `.env`** or keys.

## Syncing
- Start of each task and before opening a PR: `git fetch origin && git rebase origin/main`.
- `pnpm-lock.yaml` conflict → take `origin/main`'s version, run `pnpm install`, commit the result.
- If `packages/shared` changed upstream, re-run `pnpm typecheck` and fix your code to the new contract.

## Pull requests
- Push your branch (`git push -u origin <branch>`) and open a PR into `main` (GitHub UI or `gh pr create --fill`).
- PR description: what changed, how to test (exact commands / clicks), screenshots for UI, and any contract impact.
- Merge when typecheck passes and the golden path still works. **Squash merge.** Contract PRs need a thumbs-up from every owner in the group chat.
- Merge at least every ~2 hours so others integrate against real code, not fixtures.
- VEYZL runs on PRs — read its findings; Workstream A records one real before/after for the VEYZL track.

## Shared database
- Everyone uses the same Atlas cluster and `alfred` db (M0 search-index limits rule out one db per person).
- **Only Workstream A runs `pnpm seed`, `pnpm indexes`, or `/admin/reset`**, and announces it in the group chat first. Everyone else reads/writes app data through normal routes only.
- Never drop collections or indexes. Test writes should use the demo personas, not new ad-hoc collections.

## Boundaries
- Edit only your workstream's paths (DESIGN.md §9, CLAUDE.md). Need something from another workstream? Use its mock/fixture now and ask its owner, don't edit their files.
- Route registration: each workstream owns its own file in `apps/agent/src/routes/`; adding a new route file means one line in `apps/agent/src/index.ts` — keep that edit tiny.
- Shared `.env` keys change → tell the group; update `.env.example` (no real values).
