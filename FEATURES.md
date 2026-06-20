# TL;DW — Feature Backlog & Implementation Plan

_Created 2026-06-19. Captures the feature requests from the planning session plus a
parallelized (2-agent / worktree) implementation plan. Live status doc remains
`STATUS.md`; this is the forward-looking backlog._

---

## 0. Where we are (polish assessment)

Recent work hardened **correctness** (the 56-issue bug-fix campaign: storage
race serialization, SPA-nav staleness, parser robustness, watch-time accounting).
That was the weakest layer and is now solid. Remaining gap to a polished public
v1 is **UX polish + store-prep + the features below**.

My estimate, by dimension:

| Dimension | State | ~% |
|---|---|---|
| Core functionality (summaries, Direct API, tab flow, engagement, SponsorBlock, stats) | works | 90% |
| Correctness / robustness | just hardened, test-gated | 90% |
| Widget UX polish (clutter, hover, cue noise, prose) | rough — this backlog | 55% |
| Feature completeness vs vision (tags, dashboards, paid) | early | 35% |
| Store-readiness (privacy policy, listing, screenshots, smoke-test) | not started | 20% |

**Overall: ~70% toward a polished, publishable extension v1** (the items in §2 close
most of that gap). The **bigger "beyond-a-Chrome-extension" vision** (§3 — paid
analytics dashboards) is a separate product bet at ~35%.

---

## 1. What's been done (this session)

- **Correctness campaign (11 commits, pushed):** chrome.storage write-serialization
  (Web Locks mutex), SPA nav-epoch + videoId staleness guards, Direct-API parser
  robustness (bold labels, truncation, multi-block, value preservation), revived
  the dead AI RATING cue, transcript prompt-injection fencing, watch-time
  double-count + seek-counting fixes, React state bugs (history data-loss, popup
  choice-revert, heatmap off-by-one), inject prompt resilience, manifest/build.
- Verified by typecheck + 79 unit tests + production build, reviewed adversarially
  twice. See git log `600e7e4..dcb91f3`.

---

## 2. Immediate features (requested)

Each: **what**, **acceptance criteria (AC)**, **touchpoints**, **open decisions**.

### F1 — Overflow ("⋯") menu for secondary widget actions
**What.** The widget header has too many always-visible pills. Collapse the
secondary actions — **Clear cache**, **⚡ Gemini API / source badge**, **↗ Open
tab** (and likely Skip-channel / Auto-summarize) — into a right-aligned hamburger
/ kebab ("⋯") menu. Primary info (verdict + summary) stays; the rest is one click
away.
**AC.** Header shows verdict pill + summary + a single "⋯" button on the right.
Clicking opens a small popover with the secondary actions. Closes on outside-click
/ Esc. Works in light/dark. No layout shift / overflow on narrow widths.
**Touchpoints.** `src/content/youtube.ts` — `buildPanelHead`, `buildSummaryPanel`
header cluster (`newTabBtn`, `clearBtn`, `sourceBadge`, block/auto toggles).
**Decisions.** Which actions live in the menu vs stay inline? (Proposal: keep only
the verdict + summary inline; everything else in "⋯".)

### F2 — Engagement cue: hide raw "% watched" by default; show average; detail on click
**What.** Today the panel shows `👁 0% watched · Skimming` on load — noise while
you're still deciding. Instead:
- **Default (collapsed):** do **not** show the live "0% watched". Show the
  **per-channel average** engagement if history exists (e.g. "You usually engage
  with this channel"), or nothing if no history.
- **Detailed (one click):** expands to the live this-video detail — "0% watched ·
  Skimming", progress, verdict — i.e. the current cue moves behind a click.
- Tracking still runs in the background regardless of display.
**AC.** Fresh load never shows "0% watched". If the channel has history, a muted
average line shows. Clicking the cue (or a chevron) reveals the live %/verdict.
Respects `showEngagementStatus` (off = nothing).
**Touchpoints.** `src/content/youtube.ts` — `renderEngagementCue` (~1369–1392),
the `engagementCue` element, reads existing `channelStats.avgUserRating` +
`__tldwWatch.getState()`. (Average already flows in via `channelStats` — no new
data needed.)
**Decisions.** Exact default copy for the average line. Is the toggle its own
chevron or does clicking the panel body reveal it?

### F3 — Persist watch progress across refresh (don't reset to 0%)
**What.** The live "% watched" resets on page refresh because `watchtime.ts`
starts `totalWatched = 0` every load (`watchtime.ts:297`) and never restores the
already-accumulated `history[videoId].watchedSeconds`. Persist + restore so a
reload (or returning to a partly-watched video) resumes the real %.
**AC.** Reload a video you've watched 40% of → the cue (when expanded) shows ~40%,
not 0%. Watching more accumulates from there (no double-count with the existing
delta reporting). Rewatching across sessions keeps accumulating toward the same
video's total.
**Touchpoints.** `src/content/watchtime.ts` (`handleNav` — seed `totalWatched`
from stored value for the new vid), `src/lib/storage.ts` (a read accessor for a
video's `watchedSeconds`), `src/types/index.ts` if a furthest-position field is
added. The accumulator already persists in `history.watchedSeconds`; this is
about **restoring it on load**.
**Decisions.** Restore from `history[vid].watchedSeconds` (simplest, reuses
existing data) vs a dedicated per-video position store. Cap at duration so a
re-watch can't exceed 100%? (Proposal: restore from history, clamp to duration.)

### F4 — Consistent fill-on-hover button styling
**What.** The **Skip-channel** button (`buildBlockButton`, fills solid red + white
text on hover) is the look you want. The **Auto-summarize** toggle, **Clear
cache**, **⚡ Gemini/source** and **Open tab** pills currently only change their
**border** color on hover (low readability). Make them all fill (solid background
+ contrasting text) on hover — Auto-summarize → **blue fill + white text**.
**AC.** All header action pills use one shared hover treatment: solid feature
color background + white/contrast text on hover, back to neutral on leave.
Consistent across the auto-toggle, clear-cache, source badge, open-tab.
**Touchpoints.** `src/content/youtube.ts` — `actionPill` (1175–1191, border-only
hover), `buildAutoToggle` (707–709), `buildGeminiLink` (959–960). Factor a shared
`fillHover(btn, color)` helper. (`buildBlockButton:933` is the reference pattern.)
**Decisions.** One shared color per action or feature-colored per button?
(Proposal: a single `pillHover` helper taking a color; Auto = blue, Clear = red,
Open/source = neutral-dark.)

### F5 — Tighter, filler-free summary/details prose
**What.** The DETAILS (and to a lesser degree SUMMARY) lead with meta-framing
filler — "The video provides a masterclass in incremental improvement, focusing
on…". It should speak **as the content**, stating substance directly/imperatively.
> Bad: "The video provided a masterclass in incremental improvement, focusing on
> fixing conversion bottlenecks before scaling ad spend."
> Good: "Fix conversion bottlenecks before scaling ad spend; leverage existing
> customer databases for reactivation; structure affiliate partnerships for steady
> high-quality leads."
**AC.** Generated DETAILS no longer open with "The video / This video provides /
highlights / discusses / is a masterclass…". Statements are direct. SUMMARY stays
the one-sentence core conclusion (already good). Verified on a few real videos.
**Touchpoints.** `src/lib/promptBuilder.ts` (`appendTldwBlock` DETAILS/SUMMARY
instructions), possibly `src/lib/profiles.ts` (default templates). Add/adjust a
test in `promptBuilder.test.ts` asserting the directive wording.
**Decisions.** How strict? (Proposal: instruct "state findings directly as
claims; do not describe the video or use phrases like 'the video provides/covers/
is a masterclass'.")

### F6 — Per-channel tags (saved prompt modifiers)
**What.** Let the user attach **tags** to a channel (or a one-off video) that
shape the summary — e.g. "citations", "tutorial format", "pricing details". Better
than the existing right-click-profile flow because a tag **saved to a channel**
auto-applies on every video from that channel, making the detail view far more
useful. A **Tags button** lives on the widget.
**AC.**
- A "🏷 Tags" control on the widget opens a picker: choose/create tags, toggle
  which apply to **this channel** (persisted).
- Active tags are woven into the summary prompt (each tag carries a prompt
  fragment, like `userCuriosity`), so the summary/details reflect them.
- Per-channel assignments persist and re-apply automatically; optional per-video
  one-off application.
- Tags are manageable in the options page (create/edit/delete the tag library).
**Touchpoints (spans UI + data — see seam in §4):**
- UI: `src/content/youtube.ts` (Tags button + picker popover; writes channel→tag
  assignments to storage).
- Data: `src/types/index.ts` (`Tag`, channel-tags), `src/lib/storage.ts`
  (tag library + channel assignments accessors), `src/background/index.ts`
  (resolve a channel's active tags when building the prompt),
  `src/lib/promptBuilder.ts` (append tag fragments), `src/options/` (a Tags
  management section).
**Decisions.** Tag model: `{ id, label, prompt }` (a tag = label + the instruction
it injects). Channel-scoped only, or also global/per-video? (Proposal: a global
tag **library** + per-channel **assignments**, with optional per-summary toggle.)
Do tags affect Direct-API only or also the tab-flow prompt? (Proposal: both — it's
a prompt change.)

---

## 3. Bigger bet (future, separate epic)

### F7 — Weekly / monthly / yearly dashboards + paid analytics ("beyond the extension")
**What.** Rich time-windowed dashboards of what you watched (week/month/year),
beyond the current lifetime stats + 12-week heatmap. The "how is this more than a
Chrome extension" question → a **paid tier** that unlocks the deeper analytics
(and possibly a hosted web dashboard / cross-device sync).
**Why it's separate.** This needs product + infra decisions the §2 items don't:
- Local-only (compute windows from existing `history` + `tldwStats.activity`) vs a
  **backend** (account, sync, payment, privacy policy implications — today the
  product stores nothing off-device).
- Monetization mechanics (license check, free vs paid gating).
- The current privacy posture ("nothing leaves your browser") would change if data
  syncs — a deliberate decision.
**Phase-1 (local, no backend) is cheap and ships value now:** add week/month/year
aggregations to the existing Stats page from local data. The paid/hosted layer is
a later, scoped epic.
**Touchpoints (local phase).** `src/options/sections/StatsSection.tsx`,
`src/lib/stats`-style aggregation helpers (+ tests), reads existing
`history`/`tldwStats`.
**Decisions (need product input).** Local-only first? What gates behind "paid"?
Backend or not? — recommend deciding this separately from the §2 sprint.

---

## 4. Parallelized implementation plan (2 agents, worktrees)

> **Execution briefs live in [`agents/`](agents/README.md):** run
> [`agents/PHASE_0.md`](agents/PHASE_0.md) first, then hand
> [`agents/AGENT_A.md`](agents/AGENT_A.md) (data/prompt) and
> [`agents/AGENT_B.md`](agents/AGENT_B.md) (widget UI) to two parallel agents.
> The summary below is the rationale; the briefs are the step-by-step.

**Constraint that drives the split:** `src/content/youtube.ts` (1.9k LOC) is the
UI hotspot touched by F1, F2, F4, and F6-UI. Two agents editing it on separate
worktrees would conflict badly. So we split by **file ownership**, not by feature,
and agree the cross-file **contracts up front** so the two streams never touch the
same files.

### Phase 0 — Shared contracts (do FIRST, single small commit on `master`)
Land the types/keys/settings **both** streams reference, so Phase 1 worktrees only
*read* them and never edit the same shared files:
- `src/types/index.ts`: `Tag = { id; label; prompt }`; channel-tags shape;
  optional watched-position field.
- `src/lib/constants.ts`: new storage keys (`TAGS_KEY`, `CHANNEL_TAGS_KEY`), any
  new `DEFAULT_SETTINGS` flags (e.g. engagement-cue default mode).
- A short `CONTRACTS` note in this file (below) documenting: the tags storage
  shape, how the widget triggers a tag-aware summary, and that
  `__tldwWatch.getState().watchedSeconds` will be **restored** on load (F3) so the
  cue "just works" once A lands it.
Both worktrees branch from this commit.

### Phase 1 — Two parallel worktrees
| Stream | Owner files | Features |
|---|---|---|
| **A — Data / Prompt** | `watchtime.ts`, `storage.ts`, `promptBuilder.ts`, `profiles.ts`, `background/index.ts`, `options/sections/*`, tests | F3 (persist watch %), F5 (prose), F6-data (tags storage + prompt weaving + options mgmt), F7-local (week/month/year aggregation) |
| **B — Widget UI** | `content/youtube.ts` **only** | F1 (overflow menu), F2 (engagement cue redesign), F4 (fill hover), F6-UI (tags button + picker) |

**Why this is conflict-free:** disjoint file ownership. B reads contracts +
existing `channelStats` and `__tldwWatch`; A provides the data behind them. B
writes channel-tag assignments using the Phase-0 storage key directly (same
pattern youtube.ts already uses for `autoRunChannels`), which A's background reads.
No shared file is edited by both in Phase 1.

**Seams (the only coordination points):**
1. **F3:** A makes `watchtime.ts` restore `totalWatched` on load → B's cue shows
   the real % with zero B-side change.
2. **F6:** Phase-0 defines the channel-tags storage shape. B's picker writes it; A's
   background reads + weaves it. Neither touches the other's file.
3. **F2:** uses existing `channelStats.avgUserRating` (already passed to the
   widget) — no A dependency for the average display.

### Phase 2 — Integration
Merge A → `master`, then B → `master` (B is the larger diff; merging the smaller
data layer first de-risks). Run `npx tsc --noEmit && npx vitest run && npx vite
build`. Smoke-test the seams (reload-resumes-%, tag-changes-summary, cue default).
Then a manual Chrome pass (see §5).

### Sequencing notes / can't-fully-parallelize
- **F7 paid/hosted** is NOT in this sprint — it needs product decisions (§3). Only
  F7-local aggregation (Stream A) is in scope.
- If a 3rd agent is available, split Stream A further: A1 = `watchtime`+`storage`+
  `promptBuilder` (F3/F5/F6-data), A2 = `options/sections` (F6 management UI +
  F7-local) — these own disjoint files too.

---

## CONTRACTS (fill in during Phase 0)

```
Tag:            { id: string; label: string; prompt: string }
Tag library:    chrome.storage.local["tldwTags"]: Tag[]
Channel tags:   chrome.storage.local["tldwChannelTags"]: Record<channelKey, string[]>  // tag ids
Prompt weaving: background resolves active tag ids for the video's channel and
                appends each tag.prompt to the summary prompt (like userCuriosity).
Watch %:        watchtime.handleNav seeds totalWatched from stored watchedSeconds
                for the new videoId (clamped to duration); __tldwWatch.getState()
                then returns the restored value — widget cue unchanged.
Engagement cue: default = average (from channelStats.avgUserRating) or nothing;
                live this-video % shown only when expanded.
```

---

## Open decisions to confirm before building
1. **F1:** which actions go in "⋯" vs stay inline?
2. **F2:** default copy for the average line; chevron vs panel-click to expand.
3. **F3:** restore from `history.watchedSeconds` (reuse) vs dedicated position store.
4. **F6:** tag model (global library + per-channel assignments?) and whether tags
   apply to the tab-flow prompt too.
5. **F7:** local-only first? what gates behind paid? backend or not? (decide
   separately from the §2 sprint.)
