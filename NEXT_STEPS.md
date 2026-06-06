# TL;DW — Code Review & Next Steps

_Originally reviewed 2026-06-06 after shipping the destination system, NotebookLM
automation, auto-pause, the worth-watching verdict gate, and open-search/history in
the popup. Last updated 2026-06-06 (v0.1.35)._

---

## What's solid

- **Clean separation of concerns in the destination model** — `payload` (content:
  prompt / source / link) and `canWatch` (does it need the transcript?). Adding a
  destination is a one-line registry entry plus, if it auto-fills, a `configForHost`
  block.
- **Transcript capture is robust** — reads the intercepted InnerTube/timedtext
  network data (survives DOM redesigns), with a rendered-panel scrape as fallback.
- **Everything polls until ready** instead of fixed sleeps — timeouts are ceilings,
  not guesses. This came out of the NotebookLM tuning and is the right pattern.
- **Auto-fill degrades gracefully** — specific selectors first, then generic
  visible-element fallbacks, then a clipboard fallback with a toast. One renamed id
  no longer takes a site down, and failures are now visible (see below).
- **Privacy posture intact** — only prompt + URL + timestamp are stored, never the
  model's response.

---

## Completed

- **Popup no longer blocks on the transcript scrape.** `send()` was awaiting the full
  `runSummary` round-trip (~10s on ChatGPT/Claude/Perplexity). It now fires the `ASK`
  message and closes immediately; the worker finishes independently. _(v0.1.31)_
- **Auto-fill / gate failures surface in the popup.** The injector reports each fill
  outcome to the background → session storage → a red popup alert naming the site and
  reason, plus a toolbar badge flash. A rotted selector is now visible and fixable
  instead of failing silently. _(v0.1.32)_
- **Fixed sticky / false-alarm alerts.** The alert now reflects each site's most
  recent status (a later success clears an earlier failure), and a skipped verdict
  gate shows as a calm amber notice instead of masquerading as a delivery failure.
  _(v0.1.33)_
- **Selector resilience.** Shared `isVisible()` upgraded (rejects disconnected /
  `display:none` / `visibility:hidden`) and the composer/send-button matchers route
  through it, so generic fallbacks can't latch onto a hidden element. Broadened the
  thinnest selector lists (Perplexity editor; ChatGPT + Perplexity send). _(v0.1.34)_
- **Removed the dead clipboard delivery-mode path.** Every destination is `inject`,
  so the copy-prompt-and-open-the-site mode was unreachable. Dropped the single-valued
  `Destination.mode` field + `DestinationMode` type, `copyViaTab()` and the clipboard
  branch of `runSummary()`, the `COPY_TO_CLIPBOARD` handler + helpers in
  `youtube.ts`, and `sendViaClipboard()` in the popup (~150 lines). The live clipboard
  paths (injector fallback, copy-transcript, copy-prompt) stay. _(v0.1.35)_

---

## Declined (recorded so they don't get re-proposed)

- **Reuse an open destination tab** instead of opening a new one. Decided against —
  the user prefers a fresh tab per send.
- **"Summarize up to where I am"** (trim the transcript to the player's `currentTime`).
  Decided against.

---

## Recommended next

### 1. Clickable seek links (the big remaining feature)
Render key-moment timestamps from the summary as links that seek the YouTube player.
Needs three pieces: a structured "moments" section in the prompt output, parsing it
back out, and a clickable overlay on the YouTube page that calls
`video.currentTime = …`. Highest effort and highest novelty — worth a short design
pass before building (where the moments live, how the overlay is anchored).

---

## Smaller cleanups

- ~~The primary button reads "Ask NotebookLM" for a sources tool. Use a per-destination
  verb ("Add to NotebookLM").~~ **Done (v0.1.36)** — `destinationVerb()` keys off the
  payload: "Add to" for source/link destinations, "Ask" for chat.
- `worthWatchingMinutes` is typed as `number` but the UI only offers 15/20/30/45/60 —
  fine, just note it's not a union, so arbitrary values are storable.
- `PLAN.md` still frames the product as Gemini-only ("Alt+G", §1–§4). It predates the
  multi-destination work; worth a refresh so it matches reality.
