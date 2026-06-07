# TL;DW — Code Review & Next Steps

_Originally reviewed 2026-06-06 after shipping the destination system, NotebookLM
automation, auto-pause, the worth-watching verdict gate, and open-search/history in
the popup. Last updated 2026-06-06 (v0.1.47)._

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

### This pass (v0.1.40 – v0.1.47)

- **History stops storing transcripts + auto-expiry.** History saves a
  transcript-free prompt (was bloating `storage.local` toward its ~10 MB quota and
  quietly dragging the transcript through "Copy prompt"), plus opt-out 30-day
  auto-expiry (7/30/90/365) that prunes on write and on page load. _(v0.1.40)_
- **Key moments, fully reworked.** Panel moved from the related-videos sidebar to
  below the player (`#below`, above the title); laid out as a horizontal wrapping
  strip of chips with the timestamp revealed in a hover tooltip (below the chip);
  added an accordion collapse/expand (state persisted to `storage.local`) alongside
  close; clicking a chip now seeks **and plays**. New "Show key moments on
  summarize" setting (`autoShowMoments`, default off) auto-opens the panel after a
  send (a forced show leaves an open panel in place). _(v0.1.43 – v0.1.47)_
- **Options pages tightened.** Per-row helper copy cut to single lines, spacing
  reduced: Settings ~2034px → ~1300px, About 1758px → 1255px. History list capped to
  one viewport with internal scroll (cards get `flex:0 0 auto` so they don't squash).
  _(v0.1.41)_
- **History settings live on the History page.** Save-on-search, limit, auto-delete,
  and delete-after moved out of Settings into a compact bar docked above the entries;
  lowering the limit now trims the visible list + storage immediately (shared
  `trimToLimit`). _(v0.1.41, v0.1.46)_
- **About refactored** into scannable two-column cards. _(v0.1.41)_
- **Manifest/store + package descriptions** updated from "sends to Gemini" to the
  multi-destination wording; popup action title → "Ask AI about this video". _(v0.1.40)_
- **Popup feedback on hiding moments.** Toggling the panel off keeps the popup open
  with a "Hid key moments." note instead of silently closing. _(v0.1.46)_

### Earlier

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

### 1. Clickable seek links — v2 shipped (v0.1.38 – v0.1.47)
The on-YouTube key-moments panel is mature: `getTimedTranscript()` retains
per-segment timestamps, transcript-derived moments (no model / no answer reading),
a theme-aware panel **below the player** with horizontal hover-timestamp chips,
accordion collapse (persisted), click-to-seek-and-play, and an auto-show-on-summarize
setting. Remaining (see SEEK_LINKS.md):

- **Phase 4 — progress-bar tick markers** on the YouTube scrubber. Not started.
- **Phase 5 — model-authored moments. Parked (decision needed).** The current labels
  are a frequency heuristic and read rough. Three routes, pick one when revisiting:
  - _BYO API key_ — user supplies a Gemini/OpenAI/Anthropic key; call the model
    directly for timestamped JSON. Cleanest output; breaks the "no key" posture
    (opt-in), transcript goes to the API. Roadmap-aligned path.
  - _Scrape the AI tab_ — parse timestamps out of the rendered Moment Finder answer.
    No key, but fragile and async.
  - _Better heuristic_ — TextRank/TF-IDF sentence ranking, dedup, boundary snapping.
    Stays private/offline; not truly model-authored but a real quality jump.

---

## Smaller cleanups

- ~~The primary button reads "Ask NotebookLM" for a sources tool. Use a per-destination
  verb ("Add to NotebookLM").~~ **Done (v0.1.36)** — `destinationVerb()` keys off the
  payload: "Add to" for source/link destinations, "Ask" for chat.
- ~~`worthWatchingMinutes` is typed as `number`~~ **Done** — now the
  `WatchThresholdMinutes` union; `historyExpiryDays` is likewise `HistoryExpiryDays`.
- ~~`PLAN.md` still frames the product as Gemini-only~~ **Done** — refreshed to the
  multi-destination reality and this pass's additions.
- ~~The `archive` icon in `Icons.tsx` is unused~~ **Done** — pruned.

## Tests

Vitest covers the pure helpers (`npm test`): `expireOldEntries` / `trimToLimit`
(history.test.ts), `buildDestinationPrompt` incl. the curiosity paths
(promptBuilder.test.ts), `deriveMoments` (moments.test.ts), and
`mergeImportedProfiles` / `nextAvailableName` / `normalizeName`
(profiles.test.ts) — 34 cases. DOM/content-script behavior and the React UI
remain untested (would need jsdom + a harness).
