# Phase 0 — Shared contracts (do this FIRST, before Agent A or B start)

**Why this exists.** Agent A and Agent B work in parallel on separate worktrees
with **disjoint file ownership** so they never conflict. The only files both
streams depend on are `src/types/index.ts` and `src/lib/constants.ts`. Phase 0
lands the shared types/keys there **on `master`** so the parallel work in Phase 1
only *reads* them. This is a small, behavior-neutral commit.

**Who runs it.** The orchestrator (or whichever agent starts first). It must be
merged to `master` before Agent A / Agent B create their worktrees.

---

## Tasks

### 1. `src/types/index.ts` — add the tag model
```ts
/** A reusable summary modifier the user attaches to channels (or one-off videos).
 *  `prompt` is the instruction woven into the summary prompt (like userCuriosity). */
export type Tag = {
  id: string;
  label: string;   // shown on the widget chip + picker, e.g. "Citations"
  prompt: string;  // e.g. "Include the specific sources/citations the video relies on."
};
```
(No change needed for watch-% persistence — F3 reuses the existing
`SearchHistoryEntry.watchedSeconds`.)

### 2. `src/lib/constants.ts` — add storage keys
```ts
/** chrome.storage.local key for the user's tag library (Tag[]). */
export const TAGS_KEY = "tldwTags";
/** chrome.storage.local key mapping channel key -> tag ids (Record<string, string[]>).
 *  Channel tags auto-apply to every video from that channel. */
export const CHANNEL_TAGS_KEY = "tldwChannelTags";
/** chrome.storage.local key mapping videoId -> tag ids (Record<string, string[]>).
 *  Video tags are one-off, for a single video. "Apply to all future videos of this
 *  channel" promotes a video tag into CHANNEL_TAGS_KEY for that channel. */
export const VIDEO_TAGS_KEY = "tldwVideoTags";
```
> **channelKey = the channel DISPLAY NAME** (`getChannelInfo().name` in the widget;
> `video.channel` in the background — both scrape the same name). The background
> only has the name (not the `/@Handle` id), so tags MUST be keyed by name on both
> sides or the background's lookup misses. videoId comes from `extractVideoId(url)`.
> _(Resolved during Agent A implementation — `getActiveTags` keys channel tags by
> name.)_

### 3. Gate + land
```bash
npx tsc --noEmit      # must pass (type-only additions)
git add -A && git commit -m "feat(phase0): tag types + storage keys for the feature sprint"
# merge/push to master so A and B branch from it
```

---

## After Phase 0 — kick off the two streams

```bash
# from the repo root, AFTER phase 0 is on master:
git worktree add ../tldw-agent-a -b feat/data-prompt master
git worktree add ../tldw-agent-b -b feat/widget-ui   master
```
Then hand `agents/AGENT_A.md` to Agent A and `agents/AGENT_B.md` to Agent B.

**Ownership rule (enforced for zero conflicts):**
- `src/content/youtube.ts` → **Agent B only**.
- `src/types/index.ts`, `src/lib/constants.ts` → Phase 0; afterward **Agent A may
  extend, Agent B is read-only**.
- Everything else (`watchtime.ts`, `storage.ts`, `promptBuilder.ts`, `profiles.ts`,
  `background/index.ts`, `options/sections/*`) → **Agent A only**.
