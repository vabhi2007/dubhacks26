# Alfred — Devpost draft

> Paste-ready draft. Fill the bracketed bits at the end (team names, repo/video links, exact track submissions). Keep the numbers consistent with the demo script.

**Tagline:** Your agent spends like it's your money — because it is.

**Elevator pitch (≤ 200 chars):**
Alfred is an AI agent you can trust with a credit card. It shops as you — with scoped spending power and your rules — decides honestly (Buy/Wait/Skip), pays smart, and always asks first over iMessage.

---

## Inspiration
Everyone's shipping agents that can browse and click, but nobody actually hands one a credit card — because there's no safe way to. Real spending needs three things today's demos skip: **scoped power** (limits the agent can't exceed), **honesty** (the willingness to say *don't buy this*), and a **human in the loop**. We built the agent we'd actually trust with our own money: one that shops as you, saves you money, and checks with you before every purchase.

## What it does
Alfred is a personal shopping agent that works across your **browser, iMessage, and a dashboard** as a single assistant sharing one activity feed.

- **Snap & Find** — Send a photo (or snap a frame on any webpage) and Alfred identifies the exact product and finds the best new, used, and refurbished prices.
- **Worth-It Check** — It gives a plain-language **Buy / Wait / Skip** verdict backed by *your* spending history — e.g. "pays for itself in 3.5 months given your $640/yr at cafés, but it usually dips on weekends."
- **Agent Mandates** — You grant scoped virtual cards (cap, categories, expiry, confirm-above threshold). Money can only move inside those rules, enforced atomically in code.
- **Watcher + Smart Pay** — It watches wishlist items for price drops, then asks to buy via the right mandate and picks the card/offer that maximizes rewards.
- **Rewards Optimizer** — Mines your merchant spend and recommends loyalty programs worth real $/yr.
- **Timekeeper** — For phones: "upgrade now or wait N months" from device age, trade-in decay, and financing balance.
- **Always asks first** — Every purchase over your threshold needs a YES in iMessage; the approval becomes a receipt the moment you confirm.

## How we built it
- **Monorepo:** pnpm workspaces + Turborepo. TypeScript everywhere, Node 22.
- **Agent service:** Hono, with Claude (Anthropic TS SDK Tool Runner) as the orchestrator — **Opus for reasoning and verdicts, Haiku for bulk classification** — and structured outputs for every verdict. Sub-agents (vision, deal, worth-it, timekeeper, watcher, rewards, smart-pay) are exposed to the orchestrator as tools.
- **Guardrail:** all spending flows through a single atomic `authorize()` against MongoDB — a mandate check that a prompt can't bypass. If it fails, Alfred requests human approval instead.
- **Data & live updates:** MongoDB Atlas; change streams fan out to the dashboard over SSE and trigger iMessage, so every surface updates in real time from one source of truth.
- **Perception:** Perceptron for localization/OCR on photos and video frames, with a Claude-vision fallback.
- **Prices:** SerpAPI Google Shopping, gated behind a live/cache/mock flag; **Voyage** embeddings power product and rewards matching via Atlas Vector Search.
- **Messaging:** Photon 2.0 for iMessage (send, photo intake, YES/NO approvals) over an outbound stream — no inbound tunnel needed.
- **Web:** Next.js (App Router) + Tailwind + shadcn/ui, dark-first fintech design system with a deep-gold accent; **browser extension** on WXT (MV3) sharing the same components.
- **Guardrails:** every purchase goes through `authorize()`, an atomic Mongo check of the agent's scoped card (cap, category, expiry, status). Over the confirm threshold it asks over iMessage or the web first.

## Challenges we ran into
- Making spending **safe by construction** — the guardrail had to be atomic and impossible to talk around, which meant keeping money logic entirely in code and out of the prompt.
- Keeping **three surfaces consistent** without a mess of sync code — solved by writing everything to one event feed and letting change streams drive the UI and iMessage.
- Getting verdicts that are **honest, not just agreeable** — prompting Claude to actually recommend *Wait* or *Skip* with real math.
- Building against teammates in parallel: every external dependency sits behind an interface with a mock, so no one was ever blocked.

## Accomplishments we're proud of
- An agent that will tell you **not** to buy something — and shows its math.
- One assistant that's genuinely the same across iMessage, extension, and web.
- A spending guardrail we trust enough to demo live, validated by an external audit.

## What we learned
Trustworthy agentic commerce is mostly a **systems** problem, not a prompt problem: the interesting work is the mandate guardrail, the single event log, and the human-approval loop — the LLM is one component inside a safe envelope.

## What's next
- **Voice approvals** for high-stakes purchases (outbound call → transcript in the feed).
- Real card rails and loyalty enrollment beyond the simulated layer.
- **SideShift** — turning creator product videos into shoppable, affiliate-attributed Alfred links (see `docs/pitch/sideshift-angle.md`).

## Built with
TypeScript · Node 22 · Hono · Next.js · React · Tailwind · shadcn/ui · WXT · Anthropic Claude (Opus + Haiku) · Perceptron · Photon 2.0 · SerpAPI · Voyage AI · MongoDB Atlas · Turborepo · pnpm

## Tracks
Visa (primary) · Perceptron · Photon · T-Mobile · SideShift [confirm final list before submitting]

---
**Links:** Demo video → `[link]` · Repo → `[link]` · Team → `[names]`
