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

### F1 — Overflow ("⋯") menu for the secondary ACTION pills
**Problem.** The header has too many always-visible pills.
**Do.** Collapse the secondary **action pills** — **Clear cache**, **⚡ Gemini /
source badge**, **↗ Open tab** — into a right-aligned kebab ("⋯") that opens a
small popover. **Keep inline:** verdict pill + one-line summary + the
**Auto-summarize** and **Skip-channel** channel toggles (primary channel
controls). Build a small reusable menu (positioned `div`; close on outside-click +
Esc). **Tags are NOT in this menu** — they're a bottom row (F6-UI).
**AC.** Header = verdict + summary + Auto-summarize + Skip-channel + "⋯". The "⋯"
menu holds Clear cache / Gemini-source / Open tab. Opens/closes correctly,
light/dark, no overflow on narrow widths, no duplicate nodes on re-render (stable
id, remove-before-insert).

### F2 — Engagement cue: show the channel AVERAGE only (drop the live "% watched")
**Problem.** `renderEngagementCue` shows `👁 0% watched · Skimming` on load. The
live this-video % is just background tracking — the user doesn't want it shown.
**Do.**
- Show a muted **channel-average** line from `channelStats.avgUserRating` (map via
  the existing `userAvgToLabel`), e.g. "You usually skim this channel", **only when
  history exists**. With no history, show nothing.
- **Do NOT render the live "% watched"** at all (not on load, not on click) — it's
  background-only now. You can drop the `__tldwWatch.getState()` read and the
  `tldw-watch-update` listener from this cue (and its `__tldwCleanup`), since the
  average doesn't change live.
- Keep respecting `toggles.showEngagementStatus` (off → nothing at all).
**AC.** Fresh load never shows "0% watched" (nor on click). Average line appears
only with history; nothing otherwise. No leaked listeners.

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

### F6-UI — Bottom "Tags:" row on the loaded summary (show / add / remove / promote)
**Problem.** Users want to see and manage tags on the summary itself.
(Agent A owns the prompt weaving + options library; you build the on-widget row +
write the assignments.)
**Do.**
1. Add a **"Tags:" row at the BOTTOM of the loaded summary panel** (below the
   summary/details, alongside the existing channel/engagement rows — NOT in the
   "⋯" menu). It renders the **currently-active tags** for this video as chips:
   the channel's tags (`CHANNEL_TAGS_KEY[channelKey]`) ∪ this video's tags
   (`VIDEO_TAGS_KEY[videoId]`), resolved against the library (`TAGS_KEY` → `Tag[]`).
   Nothing is auto-added — just show what's already assigned.
2. An **"+ add"** affordance opens a small picker to: pick from the library (or
   quick-create a tag = label + prompt), and choose **for this channel** or **for
   this video only**. Each active chip has a **remove** (×) and, for a video tag, a
   **"apply to all future" (promote)** control that moves its id from
   `VIDEO_TAGS_KEY[videoId]` into `CHANNEL_TAGS_KEY[channelKey]`.
3. Persist via direct `chrome.storage.local.get/set` on `TAGS_KEY`,
   `CHANNEL_TAGS_KEY`, `VIDEO_TAGS_KEY` (same pattern this file uses for
   `autoRunChannels`). Use the SAME channel key the file derives
   (`currentChannelInfo.id` / name) and `currentVideoId()` so Agent A's background
   lookup matches.
4. Add an **"Edit tags →"** link in the row that opens the options Tags section:
   `chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "tags" })` (the
   handler already exists; Agent A renders the `"tags"` section).
**AC.** On a loaded summary you can see active channel+video tags; add a tag for
the channel or just this video; remove one; promote a video tag to the channel
("apply to all future"); jump to options to edit a tag's prompt. Persists; (once
Agent A's weaving merges) channel tags shape future summaries from that channel.
Light/dark-correct, idempotent, closes cleanly. **Seam:** use the EXACT storage
shapes from `agents/PHASE_0.md` — Agent A reads them verbatim.

### F8 — Regenerate / refresh button
**Problem.** There's no explicit way to re-run a summary (only the indirect "Clear
cache"). After adding a tag, the user wants to re-summarize with it.
**Do.** Add a **"↻ Regenerate"** action (in the "⋯" menu and/or near the Tags row)
that **force re-runs** the current video's summary: drop this video's cache entry
(`tldwSummaryCache[vid]`) then re-run — reuse the existing `clearBtn` mechanism
(it already does cache-drop + `maybeStartDirectApiRun`). The fresh run is a real
Gemini call so the usage counter increments automatically (no Agent A change).
**Tag tie-in:** if **video-only** tags were active for this regen, after the new
summary lands show a **"Save these tags for future videos of this channel?"**
affordance that promotes them (move the ids from `VIDEO_TAGS_KEY[vid]` into
`CHANNEL_TAGS_KEY[channelKey]`).
**AC.** Clicking "↻ Regenerate" shows the loading state then a fresh summary; it
counts as a Gemini request. No double-ASK / double count (respect the
`autoAskedVid` / cache-skip flow already in the file). The "save for this channel"
prompt appears only when video-only tags were in play.

---

## Definition of done (Agent B)
- All five features (F1, F2, F4, F6-UI, F8) meet their AC, all inside `youtube.ts`.
- `npx tsc --noEmit` clean, `npx vitest run` green, `npx vite build` succeeds, and
  a manual check in Chrome (load unpacked, open a watch page) looks right.
- You did NOT edit any `src/` file other than `youtube.ts`.
- Commits are logical and scoped; branch `feat/widget-ui` ready to merge. Use the
  `Co-Authored-By` trailer. Do not push to `master` directly — merge per
  `FEATURES.md` §4 Phase 2 (Agent A's data layer merges first).
