# Alfred — slide outline

> 8 slides, ~20s each on the non-demo ones. Dark deck, deep-gold accent (match the product: `#E2A829` on `#0B0B0C`, Geist). Numbers in mono. Slides 3–5 are mostly the live demo; keep slide text to a single line each so the screen isn't competing with the demo.

---

### 1 — Title
**Alfred**
*Your agent spends like it's your money — because it is.*
DubHacks '26 · Visa track (+ Perceptron, Photon, T-Mobile, VEYZL)
Small team credit line.

### 2 — The problem
Agents can *browse* and *click* — but nobody actually hands one a credit card.
Why not? **No scoped spending power, no honesty, no human in the loop.**
→ So agentic commerce stalls at "add to cart."

### 3 — What Alfred is (one sentence + the demo starts)
An agent with **scoped spending power and your rules**: it finds things, decides honestly, pays smart, and keeps saving after checkout — and it **always checks with you in iMessage first**.
*(Cut to live demo — beats 1–3 from the demo script.)*

### 4 — Honest by design (continue demo)
Buy / **Wait** / **Skip**, with math from *your* spending.
*(Live: the iPhone Timekeeper "wait 4 months" verdict in the extension.)*

### 5 — Everywhere, once (continue demo)
iMessage · Browser extension · Dashboard — **one agent, one feed, one conversation.**
*(Live: the Agent Feed showing actions that originated in iMessage.)*

### 6 — How it works (architecture)
Simple diagram: **Extension / Web / iMessage → Hono agent → Claude (Opus 5.5 / Haiku 5.5) + Perceptron + SerpAPI + Voyage → MongoDB Atlas** (change streams → live feed + iMessage).
Callout: **money moves only through `authorize()` mandates — enforced in code, not prompts.**

### 7 — Trust, proven (VEYZL)
We ran VEYZL on our own purchase guardrail.
**Before:** auto-buy could run without a human-approval cap. **After:** fixed, check passes.
"We caught our agent spending unsafely before it shipped."

### 8 — Close + ask
One agent. Every surface. Your money, your rules — and it always asks first.
**What's next:** voice approvals, real card rails, the SideShift creator-commerce angle.
Thank you / QR to Devpost + demo video.

---

## Design notes
- Max ~12 words per slide; let the demo carry it.
- Accent used once per slide (a number or the verb that matters). Never neon.
- Tabular mono for every dollar figure and payback month.
- One architecture diagram only (slide 6) — don't re-draw it anywhere else.
- Reduced-motion friendly: no slide transitions beyond a fade.
