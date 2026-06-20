# Agent A — Data / Prompt stream

> **You are Agent A.** You own the data + prompt layer. Work on your own git
> worktree on branch `feat/data-prompt`. Do **NOT** edit `src/content/youtube.ts`
> — that's Agent B's file and editing it will cause a merge conflict. Phase 0
> (`agents/PHASE_0.md`) must already be merged to `master` before you start.

## Setup
```bash
git worktree add ../tldw-agent-a -b feat/data-prompt master   # if not already created
cd ../tldw-agent-a
npm install   # if needed
```

## Files you OWN (may edit)
- `src/content/watchtime.ts`
- `src/lib/storage.ts`
- `src/lib/promptBuilder.ts`, `src/lib/promptBuilder.test.ts`
- `src/lib/profiles.ts`
- `src/background/index.ts`
- `src/options/sections/*.tsx` (you may add a new section)
- `src/types/index.ts`, `src/lib/constants.ts` — you MAY extend (Agent B is
  read-only on these)
- any test files you add

## Files you must NOT touch
- `src/content/youtube.ts` (Agent B)
- `src/content/sponsorblock.ts`, `src/content/youtube-intercept.ts`, `src/content/inject.ts`
  (out of scope this sprint)

## Background you need (read first)
- `FEATURES.md` (the product backlog + acceptance criteria) — features F3, F5,
  F6-data, F7-local are yours.
- `LESSONS_LEARNED.md` (Chrome-extension patterns) and the memory notes:
  storage writes go through `withWriteLock`/`mutateHistory`; the worker is not a
  single writer.

---

## Your tasks

### F3 — Persist watch progress across refresh
**Problem.** `watchtime.ts` sets `totalWatched = 0` on every navigation
(`handleNav`, ~line 297) and never restores the already-accumulated value, so the
live "% watched" resets to 0 on refresh / return.
**Do.**
1. Add a read accessor in `storage.ts` for a video's stored progress, e.g.
   `getWatchedSecondsForVideo(videoId): Promise<number>` (read from the newest
   `history` entry whose `extractVideoId(videoUrl) === videoId`).
2. In `watchtime.ts handleNav`, after computing the new `vid` and confirming
   tracking is on, **seed** `totalWatched` from that stored value (clamp to the
   video duration when known) before attaching listeners. Make sure the existing
   delta-reporting still accumulates correctly from the seeded base (no
   double-count: the seed is the baseline, deltas add on top).
**AC.** Reload a video you watched ~40% of → `window.__tldwWatch.getState()
.watchedSeconds` reflects ~40%, not 0. Continued watching accumulates from there.
Across sessions, the same video keeps building toward its total. Lifetime
`secondsWatched` is NOT double-counted (only newly-watched deltas are reported).
**Test.** Add a unit test for `getWatchedSecondsForVideo` (pure-ish — mock
storage or factor the lookup as a pure helper over an entries array).

### F5 — Tighter, filler-free summary/details prose
**Problem.** DETAILS leads with meta-framing filler ("The video provides a
masterclass in incremental improvement, focusing on…").
**Do.** In `promptBuilder.ts` (`appendTldwBlock`), tighten the DETAILS (and
SUMMARY if needed) instruction: state findings **directly as claims**, do NOT
describe the video or use phrases like "the video provides / covers / highlights /
discusses / is a masterclass". Prefer imperative/declarative substance.
**AC.** Generated DETAILS no longer opens with "The video / This video …".
Example target: "Fix conversion bottlenecks before scaling ad spend; reactivate
existing customer databases; structure affiliate partnerships for steady
high-quality leads." Update/add a `promptBuilder.test.ts` assertion that the
DETAILS directive includes the no-meta-framing instruction.

### F6-data — Per-channel tags (storage + prompt weaving + management UI)
**Problem.** Users want reusable tags ("citations", "tutorial format") saved to a
channel that auto-shape every summary from it. (Agent B builds the on-widget
picker; you own the data + prompt + options management.)
**Do.**
1. `storage.ts`: accessors for the tag library (`TAGS_KEY` → `Tag[]`) and channel
   assignments (`CHANNEL_TAGS_KEY` → `Record<channelKey, string[]>`): get/set,
   plus `getActiveTagsForChannel(channelKey): Promise<Tag[]>`. Route writes
   through `withWriteLock` like the other lists.
2. `background/index.ts` (`runSummary`): when building the prompt for a video,
   resolve the channel's active tags and append each `tag.prompt` to the summary
   prompt (treat like `userCuriosity` — applies to BOTH the Direct-API and
   tab-flow prompts). The channel key comes from the video's channel
   (`video.channel` / the channel id used elsewhere).
3. `promptBuilder.ts`: a helper to append tag fragments (so the weaving is
   testable), e.g. `appendTags(prompt, tags)`. Add a test.
4. `options/sections/`: a small **Tags** management section (create / edit /
   delete tags in the library). Wire it into the options nav.
**AC.** A tag assigned to a channel measurably changes that channel's summaries
(e.g. a "citations" tag makes summaries mention sources). Assignments persist and
re-apply on every video from the channel. The options Tags section CRUDs the
library. Seam with Agent B: B's widget picker writes `CHANNEL_TAGS_KEY` (channel →
tag ids) and may add to `TAGS_KEY`; your background READS them — agree on the
exact shape from `agents/PHASE_0.md` (don't diverge).

### F7-local — Week / month / year aggregation on the Stats page
**Problem.** Stats shows lifetime totals + a 12-week heatmap; user wants
week/month/year windows of what they watched.
**Do.** In `options/sections/StatsSection.tsx` (+ a pure aggregation helper with
tests), compute "this week / month / year" rollups from local data
(`history` + `tldwStats.activity`): counts, time saved, top channels per window.
Use `localDateKey` for day bucketing (timezone-correct, already in `constants.ts`).
**AC.** The Stats page shows selectable week/month/year summaries derived purely
from local data (no backend). Aggregation helper is unit-tested.
> The **paid / hosted** dashboard (F7 full) is OUT of scope — local aggregation only.

---

## Definition of done (Agent A)
- All four features meet their AC.
- `npx tsc --noEmit` clean, `npx vitest run` green (incl. your new tests),
  `npx vite build` succeeds.
- You did NOT edit `src/content/youtube.ts`.
- Commits are logical and scoped; branch `feat/data-prompt` is ready to merge.
  Use the `Co-Authored-By` trailer. Do not push to `master` directly — open for
  merge per the integration step in `FEATURES.md` §4 Phase 2.
