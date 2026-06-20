# Agent B — Widget UI stream

> **You are Agent B.** You own the on-page widget. You edit **exactly one source
> file: `src/content/youtube.ts`** (plus this brief / docs if needed). Do **NOT**
> edit any other `src/` file — the data layer is Agent A's, and editing shared
> files will cause merge conflicts. Phase 0 (`agents/PHASE_0.md`) must already be
> merged to `master` before you start.

## Setup
```bash
git worktree add ../tldw-agent-b -b feat/widget-ui master   # if not already created
cd ../tldw-agent-b
npm install   # if needed
```

## Files you OWN (may edit)
- `src/content/youtube.ts` — **this is the only source file you change.**

## Files you must NOT touch
- Everything else under `src/` — especially `watchtime.ts`, `storage.ts`,
  `promptBuilder.ts`, `background/index.ts`, `types/index.ts`, `constants.ts`,
  `options/*` (all Agent A or Phase 0). You **read** types/constants; you don't
  edit them.

## How `youtube.ts` works (read first)
- It builds the injected panel with vanilla DOM (no React). Key builders:
  `buildSummaryPanel`, `buildPanelHead`, `pill`, `actionPill` (~1175),
  `buildAutoToggle` (~670), `buildBlockButton` (~933), `buildGeminiLink` (~949),
  `renderEngagementCue` (~1377).
- Panel data arrives via the `SET_SUMMARY` message and `channelStats`
  (`ChannelComparison` with `avgUserRating`, `avgAiRating`, `count`,
  `userBreakdown`) — **already passed in**, so the engagement average is available
  without any Agent A dependency.
- Live watch state: `window.__tldwWatch.getState()` → `{ videoId, watchedSeconds,
  durationSeconds, verdict }`. After Agent A's F3 lands, `watchedSeconds` is
  **restored on reload** automatically — you don't change anything for that; your
  cue just shows the right number.
- Follow `LESSONS_LEARNED.md`: one owner per UI node, stable ids, inline styles,
  light/dark via `theme()`, `pillGeom` for consistent pill geometry.

---

## Your tasks (all in `youtube.ts`)

### F1 — Overflow ("⋯") menu for secondary actions
**Problem.** The header has too many always-visible pills.
**Do.** Collapse the secondary actions — **Clear cache**, **⚡ Gemini / source
badge**, **↗ Open tab**, and the **Skip-channel** / **Auto-summarize** toggles —
into a right-aligned kebab ("⋯") button that opens a small popover. Keep the
verdict pill + one-line summary inline. Build a small reusable menu (a positioned
`div` with the action buttons; close on outside-click and Esc).
**AC.** Header = verdict + summary + "⋯". Menu opens/closes correctly, works
light/dark, no overflow on narrow widths, no duplicate nodes on re-render
(stable id, remove-before-insert). The Tags button (F6-UI) lives here too.

### F2 — Engagement cue: hide raw "% watched" by default; show average; detail on click
**Problem.** `renderEngagementCue` shows `👁 0% watched · Skimming` on load — noise.
**Do.**
- **Default (collapsed):** do NOT render the live "0% watched". If the channel has
  history, show a muted **average** line from `channelStats.avgUserRating` (map via
  the existing `userAvgToLabel`), e.g. "You usually engage with this channel". If
  no history, show nothing.
- **Expanded (one click / chevron):** reveal the live this-video detail — the
  current `👁 X% watched · <verdict>` from `__tldwWatch.getState()`.
- Keep respecting `toggles.showEngagementStatus` (off → nothing at all).
**AC.** Fresh load never shows "0% watched". Average line appears only with
history. Clicking reveals the live %/verdict. Updates live on the
`tldw-watch-update` event when expanded (keep the existing listener + the
`__tldwCleanup` teardown pattern so it doesn't leak).

### F4 — Consistent fill-on-hover button styling
**Problem.** `actionPill` (clear-cache / source / open-tab), `buildAutoToggle`,
and `buildGeminiLink` only change their **border** on hover (low readability).
`buildBlockButton` (~933) already fills solid (red bg + white text) — that's the
target pattern.
**Do.** Factor a shared helper, e.g. `pillHover(btn, color)`, that on hover sets
solid `background = color` + `color = #fff` and restores on leave. Apply it so:
Auto-summarize → **blue fill + white text** (keep the ON/STOP red-fill state
clear), Clear cache → red fill, Open-tab / Gemini-source → neutral-dark fill.
**AC.** All header action pills fill on hover with contrasting text, consistent
look, back to neutral on leave. No regression to the auto-toggle ON/OFF state
semantics.

### F6-UI — Tags button + picker (writes channel assignments)
**Problem.** Users want to attach reusable tags to a channel from the widget.
(Agent A owns the prompt weaving + options management; you build the on-widget
picker + write the assignments.)
**Do.**
1. Add a **"🏷 Tags"** entry in the "⋯" menu (F1) that opens a picker popover.
2. The picker lists the tag library (read `TAGS_KEY` → `Tag[]` via direct
   `chrome.storage.local.get`, same pattern this file already uses for
   `autoRunChannels`), lets the user **toggle which tags apply to this channel**,
   and lets them **create** a quick tag (label + prompt) if needed.
3. Persist channel assignments to `CHANNEL_TAGS_KEY` →
   `Record<channelKey, string[]>` using `chrome.storage.local.set` (direct, like
   the auto-run writes). Use the SAME channel key the file already derives
   (`currentChannelInfo.id` / name) so Agent A's background lookup matches.
**AC.** From the widget you can tag the current channel; the assignment persists
and (once Agent A's weaving is merged) shapes that channel's future summaries.
Picker is light/dark-correct, idempotent, closes cleanly. **Seam:** the storage
shapes are fixed in `agents/PHASE_0.md` — do not invent a different shape; Agent
A reads exactly these.

---

## Definition of done (Agent B)
- All four features meet their AC, all inside `youtube.ts`.
- `npx tsc --noEmit` clean, `npx vitest run` green, `npx vite build` succeeds, and
  a manual check in Chrome (load unpacked, open a watch page) looks right.
- You did NOT edit any `src/` file other than `youtube.ts`.
- Commits are logical and scoped; branch `feat/widget-ui` ready to merge. Use the
  `Co-Authored-By` trailer. Do not push to `master` directly — merge per
  `FEATURES.md` §4 Phase 2 (Agent A's data layer merges first).
