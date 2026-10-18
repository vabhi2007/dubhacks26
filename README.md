# Alfred

> Your agent spends like it's your money — because it is. DubHacks '26 (Visa track).

Design doc: [`docs/DESIGN.md`](docs/DESIGN.md) · Agent instructions: [`CLAUDE.md`](CLAUDE.md)

## Setup
```bash
corepack enable pnpm          # Node >= 22
pnpm install
cp .env.example .env          # fill in keys (shared privately, never committed)
pnpm check:env                # every required row should be ✅
pnpm --filter @alfred/scripts setup-db
pnpm dev                      # agent :8787 · web :3100 · extension dev
```
Everything runs on fixtures with no keys at all (`PRICE_SOURCE=mock`, `VISION_SOURCE=claude`, `MESSENGER=console`), so you can start immediately.
