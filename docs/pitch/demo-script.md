# Alfred — 3-minute demo script

> Expands DESIGN.md §11 into a runnable script: who does what, exact clicks, timing, and fallbacks. Rehearse to **2:45** so there's slack. One driver on the laptop, one narrator.

**One-liner:** *Your agent spends like it's your money — because it is.*

**Setup before you present (not on camera):**
- Agent service up (`pnpm dev`), web dashboard on `:3100`, extension loaded, iMessage thread with Alfred open on the phone mirrored to screen.
- Persona reset to `u_maya` (Workstream A runs `/admin/reset`). Confirm Home shows a clean feed and the "Kitchen — $200 cap" mandate.
- `PRICE_SOURCE=mock` (or `cache`) so prices are deterministic. Have the admin panel open in a hidden tab.
- Pre-stage the café photo and the YouTube iPhone-review tab.

---

## Beat sheet (target 3:00)

| # | Time | Surface | What the audience sees | Who |
|---|------|---------|------------------------|-----|
| 0 | 0:00–0:15 | Slide | **Hook.** "Everyone's building agents that *do* things. We built one you can trust with a credit card. Alfred shops as you — with your money and your rules — and always checks with you first." | Narrator |
| 1 | 0:15–0:50 | iMessage | Text a **photo of an espresso machine** to Alfred. Reply comes back: *"That's a Breville Bambino. Best new price **$179** (vs $249 at Best Buy). Pays for itself in ~3.5 months given your **$640/yr** at cafés — but it usually dips on weekends. Want me to watch it?"* → reply **"watch it"**. | Driver |
| 2 | 0:50–1:15 | Dashboard | Switch to Home. The **Agent Feed** already shows the exact same actions from iMessage — snap → verdict → watch — because every surface writes to one feed. Point at the **"Kitchen — $200 cap"** mandate: "Alfred can only spend inside rules I set." | Narrator |
| 3 | 1:15–1:50 | Admin → iMessage | Hidden tab: **price drops to $149**. On the phone, Alfred pings: *"Bambino just hit **$149**. Buy on your Visa ••4821 (**+$4.47** back)? YES/NO."* Reply **YES**. On the dashboard the **Approval Card morphs into a Receipt** and the **savings ticker jumps +$100**, live. | Driver |
| 4 | 1:50–2:25 | Extension | Open a **YouTube review of an iPhone**, pause on a frame, hit the **Snap** hotkey, drag a box. Side panel returns a **Timekeeper** verdict: *"**Wait 4 months** — your trade-in only drops $40 and you still owe $210 on financing."* "It's just as willing to tell me **no**." | Driver |
| 5 | 2:25–2:40 | Dashboard | Rewards: *"Join Starbucks Rewards — ~**$54/yr** from your habits."* One tap to enroll (simulated). "It keeps finding money after checkout." | Narrator |
| 6 | 2:40–2:55 | Dashboard / VEYZL | Trust beat: show the **VEYZL finding** — an early build let an auto-buy run without a human-approval cap — then the fix and the **passing check**. "We caught our own agent spending unsafely before it shipped." | Narrator |
| 7 | 2:55–3:00 | Slide | **Close.** "One agent. Every surface. Your money, your rules — and it always asks first." | Narrator |

---

## The throughline to land (say it out loud at least twice)
- **Scoped power:** money moves *only* through mandates (`authorize()`), enforced in code, not by a prompt.
- **Honest:** it says Buy / **Wait** / **Skip**, with the math from your real spending.
- **Everywhere, once:** iMessage, extension, and dashboard are one agent sharing one feed and one conversation.
- **Always asks first:** every purchase above your threshold needs a YES.

## Fallbacks (if live fails, keep moving — never debug on camera)
- **iMessage won't send/receive** → switch `MESSENGER=console` narrative: show the same snap/verdict triggered from the extension; the feed still tells the story. Have a short screen-recording of the iMessage exchange as backup B-roll.
- **Price drop doesn't trigger an approval** → fire the approval directly from the admin panel; approve on web.
- **Extension snap flakes** → use the pre-captured frame; the Timekeeper verdict route still returns.
- **Network dies** → the dashboard falls back to fixtures and still renders stats, a verdict, a pending approval, and the feed. Narrate from there.
- **Anthropic latency** → pre-warm one verdict before the demo so the model is hot.

## Roles
- **Driver:** laptop + phone, executes clicks in order, stays silent except short confirmations.
- **Narrator:** owns the throughline, fills dead air during model latency, delivers hook + close.
