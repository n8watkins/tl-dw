# Agent A — Data / Prompt stream

> **📦 ARCHIVED — work merged (`cf86bf0`, via PR #1), kept for history.** This is a
> completed brief, not live work. The "F7 dashboards is PARKED — do NOT build it"
> instruction is now false (F7 Phase 1 shipped in PR #2), and some symbol names /
> line numbers below drifted from the shipped code. Live status:
> [`STATUS.md`](../../../STATUS.md).

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
- `FEATURES.md` (the product backlog + acceptance criteria + the RESOLVED
  decisions) — features F3, F5, F6-data are yours. (F7 dashboards is PARKED — do
  NOT build it.)
- `LESSONS_LEARNED.md` (Chrome-extension patterns) and the memory notes:
  storage writes go through `withWriteLock`/`mutateHistory`; the worker is not a
  single writer.

---

## Your tasks

### F3 — Persist watch tracking across refresh
**Problem.** `watchtime.ts` sets `totalWatched = 0` on every navigation
(`handleNav`, ~line 297) and never restores the already-accumulated value, so the
background engagement measurement (and the verdict) resets on refresh. Note: per
the F2 decision the live "%" is NOT displayed, but this tracking feeds the
**channel average** the user wants, so it must survive a refresh.
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
.watchedSeconds` reflects ~40%, not 0 (verdict not reset to "skip"). Continued
watching accumulates from there. Lifetime `secondsWatched` is NOT double-counted
(only newly-watched deltas are reported).
**Test.** Add a unit test for the lookup (factor it as a pure helper over an
entries array).

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

### F6-data — Tags: storage + channel/video resolve + prompt weaving + library mgmt
**Problem.** Users want reusable tags ("citations", "tutorial format") that shape
summaries — saved to a **channel** (auto-apply) and/or to a single **video**.
(Agent B builds the on-widget bottom Tags row; you own the data + prompt + options
library management.)
**Do.**
1. `storage.ts`: accessors for the tag library (`TAGS_KEY` → `Tag[]`), channel
   assignments (`CHANNEL_TAGS_KEY` → `Record<channelKey, string[]>`), and video
   assignments (`VIDEO_TAGS_KEY` → `Record<videoId, string[]>`): get/set, plus
   `getActiveTags({ channelKey, videoId }): Promise<Tag[]>` returning **channel
   tags ∪ video tags** (deduped), and a `promoteVideoTagToChannel(videoId,
   channelKey, tagId)` helper (moves the id from video→channel). Route writes
   through `withWriteLock` like the other lists.
2. `background/index.ts` (`runSummary`): resolve the current video's active tags
   (channel ∪ video) and append each `tag.prompt` to the summary prompt (treat
   like `userCuriosity` — applies to **BOTH** Direct-API and tab-flow paths).
   Channel key + videoId come from the video being summarized.
3. `promptBuilder.ts`: a helper to append tag fragments (testable), e.g.
   `appendTags(prompt, tags)`. Add a test.
4. `options/sections/`: a small **Tags** library section (create / edit / delete
   the `Tag` definitions — each tag's `label` + `prompt`). Wire it into the
   options nav AND make it reachable at the section id **`"tags"`** (the options
   app routes `OPEN_OPTIONS { section }` via the URL hash), because Agent B's
   widget "Edit tags →" link deep-links to `section: "tags"`.
**AC.** A channel tag measurably changes that channel's summaries and re-applies
to every video; a video tag affects only that video; the prompt weaves channel ∪
video tags on both paths; the options Tags section CRUDs the library. **Seam with
Agent B:** B's bottom row writes `CHANNEL_TAGS_KEY` / `VIDEO_TAGS_KEY` (and the
promote = move an id between them); your background READS them. Use the EXACT
shapes from `agents/PHASE_0.md` — don't diverge.

---

## Definition of done (Agent A)
- All three features (F3, F5, F6-data) meet their AC. (F7 is parked — not built.)
- `npx tsc --noEmit` clean, `npx vitest run` green (incl. your new tests),
  `npx vite build` succeeds.
- You did NOT edit `src/content/youtube.ts`.
- Commits are logical and scoped; branch `feat/data-prompt` is ready to merge.
  Use the `Co-Authored-By` trailer. Do not push to `master` directly — open for
  merge per the integration step in `FEATURES.md` §4 Phase 2.
