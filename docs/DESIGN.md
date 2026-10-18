# Alfred — Design Doc (DubHacks '26)

> **Name: Alfred** — the agent that shops *as you*, with your money and your rules. Use `APP_NAME` from `packages/shared/src/brand.ts` everywhere so a rename is one line.

**How to use this doc (humans and coding agents):**
- Sections 1–7 are shared context. **Section 8 contracts are frozen** — change them only via a PR to `packages/shared` that all owners see.
- Section 9 assigns four workstreams. Each owner hands their agent **this whole doc + "you own Workstream X"**. Stay inside your owned paths; consume other workstreams only through the contracts.
- Every external dependency sits behind an interface with a mock implementation, so no workstream blocks another.

---

## 1. Pitch & throughline

**An agent with scoped spending power and your rules: it finds things, decides honestly, pays smart, and keeps saving after checkout — and it always checks with you in iMessage first.**

One **Spending Profile** (mock transaction history) powers every feature. Every action lands in one **Agent Feed**, regardless of surface (dashboard, extension, iMessage).

Tracks targeted: **Visa** (main), **Perceptron** (perception), **Photon** (iMessage), **VEYZL**, **T-Mobile**, **SideShift** (pitch only). Stretch: **Photon Voice**.

## 2. Features

| ID | Feature | Summary | Tracks |
|---|---|---|---|
| F1 | **Snap & Find** | Screenshot/video frame (extension) or IRL photo (iMessage) → Perceptron localization + OCR → Claude resolves exact product → Deal agent finds best new/US price + labeled used/refurb + similar items | Visa, Perceptron |
| F2 | **Worth-It Check** | Verdict **Buy / Wait / Skip** with plain-language reasons + math from history (e.g. payback vs 12-mo café spend, budget impact, duplicate ownership, likely price drop) | Visa, T-Mobile |
| F3 | **Agent Mandates** | Scoped mock virtual cards per agent: cap, categories/merchants, expiry, confirm-above threshold. Atomic `authorize()`. Revocable from dashboard | Visa, VEYZL |
| F4 | **Smart Pay** | At purchase, pick the card / card-linked offer maximizing value; running "earned by your agent" counter | Visa |
| F5 | **Watcher** | Wishlist target prices → on drop, request approval and buy via mandate. Also flags price drops inside return window | Visa |
| F6 | **Rewards Optimizer** | Mines merchant spend → recommends (simulated one-tap enroll) from ~15 curated programs with $/yr estimate | Visa |
| F7 | **iMessage Agent** | Photon 2.0: approvals (YES/NO), photo intake, "should I buy this?" chat, rewards nudges. Shares conversation state with web | Photon |
| F8 | **Timekeeper** | Worth-It mode for phones: "Upgrade now / wait N months" from device age, financing balance, trade-in decay curve, usage; optional household plan fit | T-Mobile |
| S1 | *(stretch)* **Voice approvals** | High-stakes approvals (> call threshold) via outbound call on Photon SMS number → SIP → Retell/ElevenLabs; transcript to feed | Photon Voice |

**Non-goals:** real payments, real loyalty enrollment, real bank data, auth/multi-tenant, deployment.

## 3. Surfaces

1. **Web dashboard** (`apps/web`, :3100): Home (savings counter, latest verdicts, pending approvals), Agent Feed, Spending Profile, Wishlist/Watcher, Mandates, Rewards, Timekeeper, Chat panel.
2. **Browser extension** (`apps/extension`): toolbar/hotkey **Snap** (region select over `captureVisibleTab`) → Chrome **side panel** shows the Verdict Card, offers, "Watch" / "Buy" actions.
3. **iMessage** via Photon: text + photos in, approvals and verdict summaries out (with dashboard deep links).
4. **Demo control** (`apps/web/app/admin`): trigger price drop, advance time, reset persona, toggle `PRICE_SOURCE`, fire sample events.

Cross-surface rule: the **Verdict Card** and **Approval Card** look identical wherever they render (shared `packages/ui`).

## 4. Architecture

```
 Extension ─┐                         ┌─> Anthropic (Opus 5.5 / Haiku 5.5)
 Web ───────┼─ REST + SSE ─> apps/agent (Hono :8787) ─┼─> Perceptron (vision)
 Photon ────┘  (spectrum-ts stream; tunnel only if webhooks)  ├─> SerpAPI (prices)
                                │                     └─> Voyage (embeddings)
                                ▼
                       MongoDB Atlas (M0)
                 change streams ──> SSE fan-out + Messenger (iMessage)
```

- **apps/agent** is a separate long-running Node 22 + Hono process: orchestrator, sub-agents, Photon webhook, change-stream listeners, SSE.
- **Event flow:** anything meaningful writes an `agent_events` doc → a change stream pushes it to every SSE client; a second listener on `approvals` (status `pending`) triggers the Messenger to send iMessage.
- **Orchestrator:** Anthropic TS SDK Tool Runner (`client.beta.messages.toolRunner` + `betaZodTool`). Sub-agents are exposed as tools (`snap_find`, `worth_it`, `timekeeper`, `deal_search`, `create_watch`, `rewards_scan`, `smart_pay`, `request_approval`, `purchase`). Guardrails (mandate check, confirm-above threshold) are enforced **in code inside `purchase`**, never by prompt alone.
- **Models:** `claude-opus-5-5` for orchestrator, Worth-It, Timekeeper, product resolution (adaptive thinking; `effort: "low"` for chat routes, `"medium"` for verdicts). `claude-haiku-5-5` for bulk classification (SerpAPI result labeling, transaction categorization). Use structured outputs for every verdict.

## 5. Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo, GitHub (VEYZL connected) |
| Web | Next.js (App Router), React, Tailwind v4, shadcn/ui (Radix), Motion, Recharts (shadcn charts), Sonner, Lucide, Geist |
| Extension | WXT + React (MV3), Chrome side panel, shares `packages/ui` |
| Agent service | Node 22, Hono, `@anthropic-ai/sdk`, Zod |
| Data | MongoDB Atlas M0, official `mongodb` driver, Zod-validated documents, Faker seed |
| Search | Atlas Search (product text), Atlas Vector Search (products, rewards) — M0 index limit is tight, budget **3 search indexes** total |
| Embeddings | Voyage AI |
| Vision | Perceptron API (localization, OCR, captioning) |
| Prices | SerpAPI Google Shopping, gated by `PRICE_SOURCE=live\|cache\|mock` |
| Messaging | Photon 2.0 (`spectrum-ts`), iMessage. Inbound via the SDK's `app.messages` stream (no tunnel). cloudflared quick tunnel **only** if webhooks turn out to be required |
| Voice (stretch) | Photon SMS number → SIP → Retell or ElevenLabs |

### Env (`.env`, never committed; `.env.example` checked in)
```
MONGODB_URI=  ANTHROPIC_API_KEY=  SERPAPI_KEY=  VOYAGE_API_KEY=
PERCEPTRON_API_KEY=  PHOTON_PROJECT_SECRET=  PHOTON_PROJECT_ID=
PRICE_SOURCE=mock  VISION_SOURCE=perceptron  MESSENGER=photon   # or: claude / console
AGENT_URL=http://localhost:8787  PUBLIC_TUNNEL_URL=  DEMO_USER_ID=u_maya
```

### Repo layout
```
apps/web          dashboard + /admin            (Workstream D)
apps/extension    WXT extension                 (Workstream C)
apps/agent        Hono service                  (A: core/data/messenger, B: agents, C: vision/deal)
packages/shared   zod schemas, types, db client, event types, brand   (A owns; all PR)
packages/ui       design tokens + shared components                    (D owns)
scripts/          seed, indexes, serpapi_smoke                         (A)
docs/             this doc, demo script
```
`apps/agent/src/` folders: `core/` (A), `messenger/` (A), `agents/` (B), `vision/` + `deal/` (C), `routes/` (each owner adds their routes).

## 6. Design system

**Feel:** premium fintech — Linear / Mercury / Ramp / Arc, with a private-bank editorial touch. Calm, confident, **visual over verbose**: show a number or a graph before a sentence. Motion on state change **and** a short, one-time entrance for charts and cards.

### Color (dark-first; light mode supported)
Accent is a **tough, deep gold-yellow** — mustard/goldenrod, never neon or lemon.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0B0B0C` | `#FAFAF8` | app background |
| `--surface` | `#141416` | `#FFFFFF` | cards |
| `--surface-2` | `#1C1C1F` | `#F3F2EE` | raised / hover |
| `--border` | `#26262A` | `#E6E4DE` | hairlines (1px) |
| `--text` | `#EDEDEC` | `#141414` | primary text |
| `--text-muted` | `#8E8E93` | `#6B6A66` | secondary |
| `--accent` | `#E2A829` | `#C98E12` | primary actions, highlights, savings |
| `--accent-hover` | `#EDB842` | `#B07C0E` | |
| `--gold-gradient` | `linear-gradient(180deg, #F0C04A 0%, #E2A829 55%, #C8901A 100%)` | `linear-gradient(180deg, #DDA72A 0%, #C98E12 55%, #A9760C 100%)` | **primary (yellow) buttons**: a subtle gold sheen, not shiny; hover brightens ~4% |
| `--accent-subtle` | `rgba(226,168,41,0.12)` | `rgba(201,142,18,0.10)` | chips, selected rows |
| `--on-accent` | `#141414` | `#141414` | text on accent fills (always dark) |
| `--buy` | `#4CAF7A` | `#2F8F5B` | verdict Buy |
| `--wait` | `#E2A829` (accent) | `#C98E12` | verdict Wait |
| `--skip` | `#E5654B` | `#C9482F` | verdict Skip / declines |

Rules: accent used sparingly (≤1 primary action per view + key numbers). Never yellow text on light backgrounds below 18px — use `--on-accent` on accent fills instead.

### Type, shape, space
- **Headings:** **DM Serif Display** (page titles, section heroes, verdict headlines ≥ 20px). Never for body text or numbers.
- **Money and numbers:** **Inter Tight** with `font-variant-numeric: tabular-nums`, semibold. It's the closest free match to Robinhood's Capsule Sans. Use the `.num` class everywhere a dollar amount, percent or count appears. Hero numbers are 40–56px.
- **Body/UI:** Geist Sans. Geist Mono only for codes/ids (approval short codes, card last4).
- Scale: 12 / 14 (body) / 16 / 20 / 28 / 40 / 56 (hero numbers).
- **Corners: square (`border-radius: 0`) on everything**: cards, buttons, inputs, chips, charts, the side panel. **The one exception is credit-card visuals (mandates)**, which keep a realistic ~12px radius so they read as physical cards.
- Spacing on a 4px grid; card padding 20–24px. Elevation via a 1px border + subtle shadow; glass only on floating layers.
- **Less text:** lists are **compact rows** (≤ 56px tall). Detail lives one click away on a sub-page; verdict reasons are capped at 2 lines in lists.

### Data visualization (Recharts)
Prefer a graph whenever data has a shape. Standard charts:
| Data | Chart |
|---|---|
| Price history (90d) | **Line/area chart**, gold line, dashed horizontal line at the watch target, dot at today, shaded weekend dips |
| Payback / ROI | **Break-even bar chart**: monthly bars of cumulative savings (from the replaced spend) vs a cost line at the purchase price. The crossing month is labeled "Breaks even · month N" |
| Trade-in value (Timekeeper) | **Line chart**, with markers for "upgrade now" vs "wait N months" |
| Spend by category | **Horizontal bar** (sorted) or donut, using the category color scale |
| Mandate usage | **Progress bar / radial** on the card visual: spent vs cap |
| Offers | **Dot strip** on one price axis (new / refurb / used), best offer highlighted |
Rules: no 3D, no pie charts with > 6 slices, label the key number directly on the chart, tooltips on hover, axes minimal (no gridline clutter), colors from tokens.

### Signature components
- **Watchlist row:** a short rectangle. Product name + current price (`.num`) + target on the left, a **small product image on the right**, and a **›** arrow that opens `/wishlist/[productId]`: a sub-page with the price-history line chart, the break-even bar chart, the offers dot strip, and the verdict. No paragraphs in the row. Products without an image get a monogram tile (brand initials on `--surface-2`).
- **Mandate = credit card:** aspect ratio 1.586:1, dark metallic gradient (gold tint for the active card), EMV chip, **VISA** wordmark, `•••• 4821` in Geist Mono, mandate label as the "cardholder", expiry `MM/YY`, cap usage bar along the bottom edge. Revoked cards are desaturated with a "REVOKED" stamp.

### Motion (Motion library)
- Durations 150–250ms; springs (`stiffness ~400, damping ~35`) for layout; ease-out for fades.
- **Allowed moments:** feed items slide/fade in; savings counter ticks; Approval Card morphs → Receipt on approve; verdict skeleton → reveal; streaming agent reasoning text; mandate progress fill; side panel slide.
- **Entrance animations (once per mount):** charts draw in (lines stroke left→right, bars grow from the baseline, ~600ms ease-out); cards and rows fade-up with a 40ms stagger (max ~8 items); money values count up from 0 the first time they render. Never replay on re-render or live updates. Live updates use the state-change animations above.
- **Not allowed:** looping/ambient animation, parallax, bouncing icons, long page-load choreography (> 800ms total).
- Respect `prefers-reduced-motion`: no draw-in or count-up; render the final state with a fade only.

### Core shared components (`packages/ui`)
`VerdictCard`, `ApprovalCard` (+ `Receipt` state), `OfferRow`, `MandateCard`, `FeedItem`, `MoneyStat` (ticker), `RewardCard`, `TimekeeperChart`, `ChatPanel`, `AgentBadge` (which sub-agent acted), `SurfaceBadge` (web / extension / iMessage / voice).

## 7. Data & mock strategy

- **Hero persona `u_maya`**: UW student/young professional, 12 months of transactions (~1.5k rows): daily cafés (~$640/yr total), groceries, Target, Amazon, Spotify/Netflix, phone bill, rideshare. Two backup personas for judges.
- **Products** (~200 mock + SerpAPI cache). **Hero products frozen**: Breville Bambino (F1/F2 demo) and an iPhone (F8 demo).
- **Price history**: synthetic 90-day series per product (with realistic dips) — SerpAPI never polled by Watcher.
- **Rewards programs** (~15), **cards & offers** (3 user cards, ~20 card-linked offers), **devices / trade-in curves / plans** (T-Mobile; synthetic).
- `PRICE_SOURCE`: `live` → SerpAPI (then cache), `cache` → Mongo only, `mock` → mock catalog. Same for `VISION_SOURCE` (`perceptron` → Claude on error | `claude` | `mock`) and `MESSENGER` (`photon` | `console`).

---

## 8. Contracts (frozen — `packages/shared`)

### 8.1 Collections
| Collection | Key fields | Notes |
|---|---|---|
| `users` | `_id, name, phone, settings{confirmAboveCents, callAboveCents, monthlyBudgets{cat:cents}}` | |
| `transactions` | `ts, meta{userId, merchantId, category}, amountCents, cardId` | **time series** (`timeField: ts, metaField: meta`) |
| `merchants` | `_id, name, category, mcc, rewardsProgramId?` | |
| `products` | `_id, title, brand, model, category, imageUrl, embedding[], source('mock'\|'serpapi'), canonicalKey` | Atlas Search + Vector index |
| `offers` | `productId, seller, priceCents, condition('new'\|'used'\|'refurb'), region, url, matched('exact'\|'variant'\|'different'), fetchedAt` | |
| `price_history` | `ts, meta{productId, seller}, priceCents` | **time series** |
| `wishlist` | `userId, productId, targetPriceCents, mandateId, status('watching'\|'triggered'\|'bought'\|'cancelled')` | |
| `mandates` | `_id, userId, agent, label, capCents, spentCents, categories[], merchants[], expiresAt, status('active'\|'revoked'\|'expired'), card{last4, token}` | |
| `cards` | `_id, userId, network:'visa', name, last4, rewards{category:multiplier}` | |
| `card_offers` | `cardId, merchantId?, category?, kind('cashback'\|'points'), value, expiresAt` | |
| `rewards_programs` | `_id, name, merchantIds[], perks, valueModel, embedding[]` | Vector index |
| `enrollments` | `userId, programId, status('recommended'\|'enrolled'\|'dismissed'), estAnnualValueCents` | |
| `devices`, `tradein_curves`, `plans` | T-Mobile mock data | |
| `verdicts` | see `Verdict` | |
| `approvals` | `_id, userId, kind('purchase'\|'enroll'), status('pending'\|'approved'\|'denied'\|'expired'), amountCents, productId?, offerId?, mandateId?, channel('imessage'\|'web'\|'voice'), shortCode, expiresAt, resolvedAt?` | listener on insert → Messenger |
| `orders` | `_id, userId, productId, offerId, mandateId, cardId, amountCents, rewardEarnedCents, ts` | |
| `agent_events` | see `AgentEvent` | change stream → SSE |
| `conversations` | `userId, surface, messages[{role, text, ts, attachments?}]` | shared across surfaces |

Expiry of mandates/approvals is enforced **in query filters** (not TTL deletion — we need history). TTL index only on ephemeral `approval_codes` if used.

### 8.2 Core types (source of truth: Zod in `packages/shared/src/schemas.ts` — this is a summary)
Ids are prefixed strings (`prd_…`, `evt_…`) stored as `_id`, created with `newId()` from `@alfred/shared/db`.
```ts
type Verdict = {
  _id: string; userId: string; productId: string;
  kind: 'buy' | 'wait' | 'skip';
  mode: 'worth_it' | 'timekeeper';
  headline: string;                 // "Pays for itself in 3.5 months — but wait for Friday"
  reasons: string[];                // 2–4 plain-language bullets
  math: { priceCents: number; bestOfferId?: string; paybackMonths?: number;
          relatedSpend12moCents?: number; budgetImpactPct?: number;
          expectedDropCents?: number };
  smartPay?: { cardId: string; offerId?: string; rewardCents: number };
  timekeeper?: { waitMonths: number; costNowCents: number; costLaterCents: number;
                 tradeInSeries: { month: number; valueCents: number }[] };
  createdAt: string;
};

type AgentEvent = {
  _id: string; userId: string; ts: string;
  agent: 'orchestrator'|'vision'|'deal'|'worth_it'|'timekeeper'|'watcher'|'rewards'|'smart_pay'|'messenger';
  surface: 'web'|'extension'|'imessage'|'voice'|'system';
  type: 'snap'|'verdict'|'watch_created'|'price_drop'|'approval_requested'|'approval_resolved'
      |'purchase'|'mandate_declined'|'reward_recommended'|'reward_enrolled'|'message';
  summary: string;                  // one line for the feed
  refs: { productId?: string; verdictId?: string; approvalId?: string;
          mandateId?: string; orderId?: string };
};

// purchase guardrail — the only way money moves
authorize(mandateId, amountCents, merchantId, category):
  findOneAndUpdate(
    { _id, status:'active', expiresAt:{$gt:now}, $expr:{$lte:[{$add:['$spentCents',amt]},'$capCents']},
      $or:[{categories:category},{merchants:merchantId}] },
    { $inc:{ spentCents: amt } })
  → null ⇒ emit 'mandate_declined' and request approval instead
```

### 8.3 Agent service API (`apps/agent`, :8787)
| Method & path | Owner | Body → Response |
|---|---|---|
| `POST /snap` | C | `{image: base64, source:'extension'\|'imessage', pageUrl?}` → `{product, offers[], similar[], verdict}` |
| `POST /chat` | B | `{text, surface, attachments?}` → SSE stream of `{delta}` then `{done, verdictId?}` |
| `GET /events` | A | SSE stream of `AgentEvent` |
| `GET /profile` | A | `{totals12moCents, txCount, window{from,to}, byCategory[{category, totalCents, txCount}], byMonth[{month:"YYYY-MM", totalCents, byCategory{cat:cents}, partial}], recurring[{merchant, merchantId, category, monthlyCents, cadence:"weekly"\|"biweekly"\|"monthly", lastChargedAt}], topMerchants[{merchant, merchantId, category, totalCents, txCount}]}` — trailing 365 days, positive amounts (same window as Worth-It); months in Seattle time, oldest first, zero-filled, first/last partial; recurring = ≥3 charges on a regular rhythm, still active |
| `GET /products/:id` | A | `{product, offers[] (ranked: new US exact → other new → used/refurb, cheapest first), priceHistory[{ts, priceCents, seller}] (90d, new+exact sellers), latestVerdict \| null, watch \| null, breakEven \| null}` — `breakEven = {priceCents, monthlySavingsCents, months[{month, cumulativeSavingsCents}]}` from the verdict's `relatedSpend12moCents ÷ 12` (same basis as `paybackMonths`). `product.imageUrl` is set only for hand-picked items; otherwise show a monogram |
| `GET /verdicts/:id` | B | `Verdict` |
| `GET/POST /wishlist` | B | list / `{productId, targetPriceCents}` |
| `GET/POST /mandates`, `POST /mandates/:id/revoke` | A | |
| `GET /approvals?status=pending`, `POST /approvals/:id` | A | `{decision:'approve'\|'deny', channel}` |
| `GET /rewards`, `POST /rewards/:programId/enroll` | B | recommendations with $/yr |
| `GET /timekeeper` | B | `Verdict` (mode timekeeper) for current device |
| `GET /stats` | A | `{savedCents, rewardsEarnedCents, purchases, activeWatches}` |
| `POST /webhooks/photon` | A | inbound iMessage → orchestrator |
| `POST /admin/price-drop` `{productId, newPriceCents}` · `/admin/advance-time {days}` · `/admin/reset` | A | demo control |

### 8.4 Internal interfaces (swap real ↔ mock)
```ts
interface Vision    { detect(img: Uint8Array): Promise<{objects:{label,bbox,conf}[]; ocr:string[]; caption?:string}> }
interface PriceSrc  { search(query: string): Promise<RawOffer[]> }       // live | cache | mock
interface Messenger { send(userId, msg: {text, imageUrl?, link?}): Promise<void>; onInbound(handler) }
interface Embedder  { embed(texts: string[]): Promise<number[][]> }
```

---

## 9. Workstreams (4 owners)

### A — Platform, Data & Messaging
**Owns:** `packages/shared`, `scripts/`, `apps/agent/src/core`, `apps/agent/src/messenger`, Atlas setup, VEYZL.
- Monorepo scaffold, `.env.example`, Hono skeleton with route registration for others.
- Zod schemas + db client; **seed script** (personas, transactions, products, price history, cards/offers, rewards, T-Mobile data); indexes (time series, Atlas Search, Vector).
- `authorize()` + `purchase()` guardrail, mandates/approvals/stats/profile routes.
- Change streams → SSE `/events`; approvals listener → Messenger.
- **Photon iMessage** Messenger (send, inbound via `app.messages` stream, photo download → `/snap`, YES/NO parsing → approvals); `console` Messenger fallback. Tunnel only if webhooks are required — see §12.
- `/admin` endpoints. **VEYZL**: connect repo early, run audit on the purchase/guardrail PR, record before/after.
- *Stretch:* Photon Voice (S1).

### B — Agent Brain
**Owns:** `apps/agent/src/agents`.
- Orchestrator (Tool Runner, system prompt, tool registry, conversation memory from `conversations`).
- **Worth-It** (aggregations over transactions → structured `Verdict`), **Timekeeper** (F8), **Rewards Optimizer** (F6, vector match + $/yr), **Smart Pay** (F4), **Watcher** logic (F5: on `price_drop` event → check budget/mandate → `request_approval` or buy).
- `/chat`, `/verdicts`, `/wishlist`, `/rewards`, `/timekeeper` routes.
- Prompt quality: verdicts must say **why**, and must be willing to say Wait/Skip.

### C — Vision, Deals & Extension
**Owns:** `apps/agent/src/vision`, `apps/agent/src/deal`, `apps/extension`.
- **Perceptron** Vision impl + Claude-vision fallback; product resolution (Atlas Search fuzzy match on OCR text → Claude picks exact model).
- **Deal agent**: SerpAPI (`PriceSrc` live/cache/mock), Haiku labeling (exact/variant/different, new/used/refurb, region), ranking, similar items via Vector Search. `/snap` route.
- **Extension** (WXT): hotkey + region-select snap, side panel rendering `VerdictCard` / offers / Watch / Buy, live updates via `/events`.
- Video frame demo (pause video → snap).

### D — Dashboard, Design System & Pitch
**Owns:** `packages/ui`, `apps/web`, pitch assets.
- Design tokens (Section 6) + shared components (start with static mock props from Section 8 types so C can consume immediately).
- Dashboard pages: Home, Feed, Spending Profile (Recharts + one embedded Atlas Chart), Wishlist, Mandates, Rewards, Timekeeper, Chat panel; `/admin` UI.
- Demo video, slides, Devpost write-up, SideShift startup angle (creator-video → affiliate distribution).

### Integration points (who waits on whom — use mocks until ready)
- C and D consume `packages/shared` types on day one → A publishes schemas **first**.
- D renders from mock JSON fixtures in `packages/shared/fixtures/` until routes are live.
- B calls C's `snap_find`/`deal_search` via the internal interface; C ships a mock first.
- Messenger (A) only needs `approvals` + orchestrator entry point (B).

## 10. Milestones — MVP-first

**Rule: get one thin, end-to-end, demo-able platform on `main` ASAP, then grow it tier by tier.** Each tier must leave `main` demo-able. Don't start tier N+1 work until your tier N PRs are merged. Thin and wired beats complete and isolated — stub what you must, but keep the whole loop working.

| Tier | Target | Exit criteria (all on `main`) |
|---|---|---|
| **MVP-0 — Core loop** | **~3–4h** | Dashboard Home shows stats, live Agent Feed (SSE), latest verdict, pending approvals. Extension snap → `/snap` (mock vision + mock/cached prices) → **real Claude Worth-It verdict** in the side panel → Watch. `/admin` price drop → Watcher creates approval → approve on web → `purchase()` via mandate → feed + stats update live. iMessage = console. |
| **MVP-1 — Real inputs & iMessage** | ~+3–4h | Perceptron vision live; SerpAPI live with cache + Haiku labeling; Atlas Search product resolution; Photon iMessage: approvals (YES/NO), photo intake → snap, verdict summaries; orchestrator + `/chat`. |
| **MVP-2 — Feature breadth** | ~+3–4h | Rewards Optimizer (+ Vector Search), Smart Pay, Timekeeper (T-Mobile), Spending Profile charts, Wishlist + Mandates pages, region-select + video-frame snap. |
| **MVP-3 — Polish & submit** | remaining | Motion pass, empty/loading/error states, reduced motion, demo reset reliable, VEYZL before/after, pitch + video, track submissions. |
| *Stretch* | — | Photon Voice outbound approval call (S1). |

### MVP-0 scope per workstream
- **A:** *minimal* seed — `u_maya` only, 12 months of transactions (café spend), cards, 2 mandates, hero products (Bambino + iPhone) with offers and 90-day price history; `/stats`, `/mandates`, `/approvals` (list + resolve → `purchase()`), `/events` via change streams, `/admin/price-drop`, `/admin/reset`; `purchase()` on `authorize()`. Full catalog, backup personas, rewards, T-Mobile data, and Atlas Search/Vector indexes → MVP-1/2.
- **B:** Worth-It verdict (structured output, real Claude) exported as a function C's `/snap` calls; `/wishlist` (create watch); Watcher reacting to `price_drop` → approval (or buy within mandate). Orchestrator, `/chat`, Timekeeper, Rewards, Smart Pay → MVP-1/2.
- **C:** `/snap` real pipeline wired end to end with **mock** vision + `PRICE_SOURCE=mock|cache` (hero products), calling B's Worth-It (fixture until merged); extension side panel shows verdict + offers + Watch. Perceptron, SerpAPI, region select → MVP-1/2.
- **D:** app shell + Home (stats, live feed, latest verdict, pending approvals with Approve/Deny) + `/admin` (price drop, reset). Core components: `VerdictCard`, `ApprovalCard`, `FeedItem`, `MoneyStat`. Other pages/components → MVP-2; motion polish → MVP-3 (basic transitions fine earlier).

## 11. Demo script (3 min)
1. **Hook:** "Your agent spends like it's your money — because it is."
2. Text a photo of a café espresso machine to Alfred's iMessage → reply: best new price $179 (vs $249), *"Pays for itself in 3.5 months given your $640/yr at cafés — but it usually drops on weekends. Wait?"* → reply "watch it".
3. Dashboard: Agent Feed shows snap → verdict → watch (from iMessage). Mandate "Kitchen — $200 cap" visible.
4. Admin: price drops to $149 → iMessage "Now $149. Buy on your Visa ••4821 (+$4.47 back)? YES/NO" → YES → Approval Card morphs to Receipt on dashboard, savings ticker +$100.
5. Extension: pause a YouTube review of an iPhone → Snap → side panel Timekeeper: *"Wait 4 months — your trade-in only drops $40 and you still owe $210."*
6. Rewards: "Join Starbucks Rewards — ~$54/yr from your habits" → one tap.
7. Trust: show VEYZL finding (auto-buy lacked human-approval cap) → fix → passing check.
8. Close: one agent, every surface, always asks first.

## 12. Open items
- ~~Perceptron API~~ → resolved: `https://api.perceptron.inc/v1/chat/completions` (OpenAI-style, Bearer auth), model `perceptron-mk1.5`; images as `image_url` (URL or base64 data URL). Localization/OCR via prompting.
- Photon inbound: **prefer the `spectrum-ts` `app.messages` stream** (outbound connection, nothing exposed). Only if webhooks are required, A runs a cloudflared quick tunnel (`cloudflared tunnel --url http://127.0.0.1:8787`) from one laptop, with these rules:
  - The URL changes on every restart → update `PUBLIC_TUNNEL_URL` and the Photon dashboard; one person owns it.
  - The tunnel exposes the **whole** agent API. `/webhooks/photon` must verify Photon's signature/secret and reject everything else; requests arriving via the tunnel (check `cf-connecting-ip` / `Host`) are allowed **only** on `/webhooks/photon` — `/admin/*`, `/approvals`, etc. return 403.
  - Run the tunnel only while testing or demoing iMessage.
- Atlas M0 search-index limit → verify; fall back to `$regex` text match if needed.
