# Agent briefs — parallel feature sprint

Self-contained execution briefs for running the [FEATURES.md](../FEATURES.md)
sprint as **two parallel agents on separate git worktrees** with disjoint file
ownership (zero merge conflicts by construction).

| Brief | Role | Owns | Features |
|---|---|---|---|
| [PHASE_0.md](PHASE_0.md) | Prerequisite (run first, on `master`) | `types/index.ts`, `constants.ts` (shared contracts) | `Tag` type + tag storage keys (channel + video) |
| [AGENT_A.md](AGENT_A.md) | Data / Prompt | `watchtime.ts`, `storage.ts`, `promptBuilder.ts`, `profiles.ts`, `background/`, `options/` | F3 persist tracking, F5 prose, F6-data tags (channel+video weaving + library) |
| [AGENT_B.md](AGENT_B.md) | Widget UI | `content/youtube.ts` **only** | F1 ⋯ menu, F2 average-only cue, F4 fill hover, F6-UI bottom Tags row + "Edit tags →", F8 ↻ Regenerate |

> F7 (dashboards/paid) is **parked** — not in this sprint.

## How to use
1. Land **Phase 0** on `master` first (`PHASE_0.md`).
2. Tell one agent "**you are Agent A**" → it follows `AGENT_A.md`; tell another
   "**you are Agent B**" → it follows `AGENT_B.md`. They run concurrently.
3. Integrate per `FEATURES.md` §4 Phase 2 (merge Agent A's data layer first, then
   Agent B), then run the gates + a manual Chrome smoke-test.

**Hard rule:** only Agent B edits `src/content/youtube.ts`; Agent A owns
everything else. This is what makes the two worktrees conflict-free.
