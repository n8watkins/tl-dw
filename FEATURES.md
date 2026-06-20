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

Each: **what**, **acceptance criteria (AC)**, **touchpoints**. _Decisions resolved
2026-06-19 — see the ✅ DECIDED lines._

### F1 — Overflow ("⋯") menu for secondary widget actions
**What.** The widget header has too many always-visible pills. Collapse the
secondary **action pills** — **Clear cache**, **⚡ Gemini API / source badge**,
**↗ Open tab** — into a right-aligned kebab ("⋯") menu. Verdict + summary stay
inline. The **Auto-summarize** and **Skip-channel** channel toggles stay visible
(they're primary channel controls). Tags are NOT in this menu — they get their
own bottom row (see F6).
**✅ DECIDED.** Inline: verdict + summary + Auto-summarize + Skip-channel. In "⋯":
Clear cache, Gemini/source, Open tab. (Default; easy to move an item later.)
**AC.** Header shows verdict + summary + the two channel toggles + a single "⋯".
Clicking "⋯" opens a small popover with the action items. Closes on outside-click
/ Esc. Light/dark correct, no overflow on narrow widths, idempotent (stable id).
**Touchpoints.** `src/content/youtube.ts` — `buildPanelHead`, `buildSummaryPanel`
header cluster (`newTabBtn`, `clearBtn`, `sourceBadge`).

### F2 — Engagement cue: show the channel AVERAGE only (drop the live "% watched")
**What.** Today the panel shows `👁 0% watched · Skimming` on load. The live
this-video % is just background tracking — **don't display it at all**. Instead
show the **per-channel engagement average** ("what you usually do with this
channel") when history exists; nothing when there's no history.
**✅ DECIDED.** No live "% watched" display anywhere (background-only). Show the
channel average from `channelStats.avgUserRating` (via `userAvgToLabel`), e.g.
"You usually skim this channel". Respect `showEngagementStatus` (off = nothing).
**AC.** Fresh load never shows "0% watched" (nor on click). With history, a muted
average line shows; without history, nothing. Background verdict tracking still
runs (feeds the average + history) — see F3.
**Touchpoints.** `src/content/youtube.ts` — `renderEngagementCue` (~1377), the
`engagementCue` element. Reads existing `channelStats.avgUserRating` (already
passed in). The live-`__tldwWatch.getState()` read for display can be removed; the
window bridge stays for background tracking.

### F3 — Persist watch tracking across refresh (don't reset to 0)
**What.** `watchtime.ts` starts `totalWatched = 0` every load (`watchtime.ts:297`)
and never restores the accumulated `history[videoId].watchedSeconds`, so a refresh
resets the in-page engagement measurement (and the verdict recomputes from 0).
Even though we no longer DISPLAY the live % (F2), this tracking feeds the
**average** the user does want, so it must survive a refresh. Seed `totalWatched`
from the stored value on load.
**✅ DECIDED.** Restore from `history[vid].watchedSeconds`, clamped to duration.
**AC.** Reload a video you've watched ~40% of → background state resumes at ~40%
(verdict not reset to "skip"); continued watching accumulates from there without
double-counting the lifetime `secondsWatched`. Across sessions the same video
keeps building toward its total.
**Touchpoints.** `src/content/watchtime.ts` (`handleNav` — seed `totalWatched`),
`src/lib/storage.ts` (a read accessor for a video's stored `watchedSeconds`).

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
**✅ DECIDED.** Instruct: "state findings directly as claims; do NOT describe the
video or use phrases like 'the video provides / covers / highlights / is a
masterclass'."

### F6 — Tags (channel + per-video saved prompt modifiers)
**What.** Reusable **tags** that shape the summary — e.g. "citations", "tutorial
format", "pricing details". A tag carries a prompt fragment woven into the summary
(like `userCuriosity`), so the summary/details reflect what you actually want from
that creator. Far more useful than the right-click flow because tags persist.
**✅ DECIDED — model & UX:**
- **Channel tags** auto-apply to every video from that channel.
- **Video tags** are one-off, for a single video.
- An **"Apply to all future videos of this channel"** action promotes a video tag
  into a channel tag.
- **Display:** a **"Tags:" row at the BOTTOM of the loaded summary** (below the
  one-line summary / details), shown once the summary is loaded. It renders the
  currently-active tags (channel + video) as chips; nothing is auto-added — but
  the user can **add a tag (for this channel / for this video)** from that row, and
  remove one. The ⋯ menu does NOT contain tags.
- Tags affect **both** the Direct-API and the tab-flow prompt (it's a prompt
  change). Tag library (create/edit/delete) is also managed in the options page.
**AC.** From the bottom row you can: see active channel+video tags on a loaded
summary; add a tag for the channel or just this video; promote a video tag to the
channel ("apply to all future"); remove a tag. Channel tags re-apply automatically
to future videos and measurably change those summaries. Persists across reloads.
**Touchpoints (spans UI + data — see seam in §4):**
- UI: `src/content/youtube.ts` (bottom "Tags:" row + add/remove/promote controls;
  writes channel→tag and video→tag assignments to storage).
- Data: `src/types/index.ts` (`Tag`), `src/lib/storage.ts` (tag library + channel
  + video assignment accessors, incl. a promote helper),
  `src/background/index.ts` (resolve a video's active tags = channel tags ∪ video
  tags when building the prompt), `src/lib/promptBuilder.ts` (append tag
  fragments), `src/options/` (Tags library management).
**Storage (Phase 0):** `TAGS_KEY: Tag[]`, `CHANNEL_TAGS_KEY: Record<channelKey,
string[]>`, `VIDEO_TAGS_KEY: Record<videoId, string[]>`.
**Edit-tags link.** The Tags row includes an **"Edit tags →"** link that
deep-links to the options **Tags** section (via the existing `OPEN_OPTIONS`
message with `section: "tags"`), where the user edits each tag's prompt fragment.
Editing a tag's `prompt` changes what future summaries produce (e.g. citations).

### F8 — Regenerate / refresh button (re-run the summary fresh)
**What.** There's no way to re-run a summary today (only "Clear cache" indirectly).
Add an explicit **"↻ Regenerate"** button that force-re-runs the summary for the
current video, **bypassing the cache** — the primary use is "I just added a tag,
re-summarize with it". A fresh run is a real Gemini call, so it **increments the
usage counter** (already automatic on a real Direct-API call) — surface the count
if shown.
**✅ DECIDED — tie-in with tags.** After a regenerate that used **video-only**
tags, offer a "**Save these tags for future videos of this channel?**" action (=
the F6 promote: move the video tag ids into the channel). This is the natural
"try a tag on one video, then keep it for the channel" loop.
**AC.** Clicking "↻ Regenerate" drops this video's cached summary and re-runs
(shows the loading state, then the new summary). It counts as a Gemini request
(usage increments). If video-only tags were active, a "save for this channel"
affordance appears after the new summary lands. No duplicate ASK / double count.
**Touchpoints.** `src/content/youtube.ts` (Agent B) — clear this video's cache
entry then re-run (the existing `clearBtn` already does cache-drop + re-run; F8 is
an explicit, tag-aware version). Usage increment is automatic in
`background/index.ts` on the real call — no Agent A change required.

---

## 3. Bigger bet (PARKED — revisit later)

> **✅ DECIDED (2026-06-19): not this sprint.** F7 is deferred — a "follow up
> later" item. Not in the Agent A/B scope below. Captured here so we don't lose it.
> **Full phased outline:** [`docs/F7_DASHBOARDS.md`](docs/F7_DASHBOARDS.md)
> (Phase 1 = local week/month/year rollups, ships free now; Phase 2 = the paid /
> "beyond the extension" bet).

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
See [`agents/PHASE_0.md`](agents/PHASE_0.md). Lands the types/keys **both** streams
reference: `Tag = { id; label; prompt }` and the storage keys `TAGS_KEY`,
`CHANNEL_TAGS_KEY` (channel→tag ids), `VIDEO_TAGS_KEY` (videoId→tag ids). Both
worktrees branch from this commit; Phase 1 only *reads* these.

### Phase 1 — Two parallel worktrees
| Stream | Owner files | Features |
|---|---|---|
| **A — Data / Prompt** | `watchtime.ts`, `storage.ts`, `promptBuilder.ts`, `profiles.ts`, `background/index.ts`, `options/sections/*`, tests | F3 (persist tracking), F5 (prose), F6-data (tags storage + channel/video resolve + prompt weaving + options **Tags** section reachable at `section:"tags"`) |
| **B — Widget UI** | `content/youtube.ts` **only** | F1 (⋯ menu), F2 (average-only cue), F4 (fill hover), F6-UI (bottom Tags row: show/add/remove/promote + "Edit tags →" link), F8 (↻ Regenerate) |

_F7 (dashboards) is PARKED — not in this sprint._

**Why this is conflict-free:** disjoint file ownership. B reads contracts +
existing `channelStats`; A provides the data behind them. B writes channel/video
tag assignments using the Phase-0 storage keys directly (same pattern youtube.ts
already uses for `autoRunChannels`), which A's background reads. No shared file is
edited by both in Phase 1.

**Seams (the only coordination points):**
1. **F3:** A restores `totalWatched` on load → the background engagement tracking
   (which feeds B's average) resumes correctly; no B-side change.
2. **F6:** Phase-0 fixes the channel/video tag storage shapes. B's bottom row
   writes them (incl. the promote = move a video tag into `CHANNEL_TAGS_KEY`); A's
   background reads `channel tags ∪ video tags` and weaves them. Neither edits the
   other's file.
3. **F2:** uses existing `channelStats.avgUserRating` (already passed to the
   widget) — no A dependency for the average display.

### Phase 2 — Integration
Merge A → `master`, then B → `master` (B is the larger diff; merging the smaller
data layer first de-risks). Run `npx tsc --noEmit && npx vitest run && npx vite
build`. Smoke-test the seams (reload-resumes-%, tag-changes-summary, cue default).
Then a manual Chrome pass (see §5).

### Sequencing notes / can't-fully-parallelize
- **F7 (dashboards/paid)** is PARKED — not in this sprint (§3).
- If a 3rd agent is available, split Stream A: A1 = `watchtime`+`storage`+
  `promptBuilder`+`background` (F3/F5/F6-data), A2 = `options/sections` (F6
  library management) — disjoint files.

---

## CONTRACTS (land in Phase 0)

```
Tag:            { id: string; label: string; prompt: string }
Tag library:    chrome.storage.local["tldwTags"]:        Tag[]
Channel tags:   chrome.storage.local["tldwChannelTags"]: Record<channelKey, string[]>  // tag ids, auto-apply
                channelKey = getChannelInfo().id (else name); background resolves by
                id OR name (getVideoMeta returns channelId)
Video tags:     chrome.storage.local["tldwVideoTags"]:   Record<videoId, string[]>     // tag ids, one-off
Promote:        "apply to all future videos of this channel" moves a video tag id
                from tldwVideoTags[videoId] into tldwChannelTags[channelKey].
Prompt weaving: background resolves (channel tags ∪ video tags) for the current
                video and appends each tag.prompt to the prompt (like userCuriosity),
                on BOTH the Direct-API and tab-flow paths.
Watch tracking: watchtime.handleNav seeds totalWatched from the stored
                history[videoId].watchedSeconds (clamped to duration) so background
                engagement tracking survives a refresh.
Engagement cue: show the channel average (channelStats.avgUserRating via
                userAvgToLabel) if history exists, else nothing. The live "%
                watched" is NOT displayed (background-only).
Tags row:       a "Tags:" row at the bottom of the loaded summary shows active
                channel+video tags as chips, with add (channel/video), remove,
                promote controls, and an "Edit tags →" link. Nothing is auto-added.
Edit-tags link: OPEN_OPTIONS message with section:"tags" → Agent A renders an
                options Tags section at that section id (deep-link).
Regenerate:     F8 "↻ Regenerate" drops this video's cache entry then re-runs
                (re-ASK) — a real Gemini call (usage increments). After a regen
                that used video-only tags, offer "save for this channel" (promote).
```

---

## Decisions — RESOLVED 2026-06-19
1. **F1:** Inline = verdict + summary + Auto-summarize + Skip-channel. In "⋯" =
   Clear cache, Gemini/source, Open tab. Tags are NOT in the menu.
2. **F2:** No live "% watched" anywhere — show the channel **average** only (or
   nothing when no history). It's background tracking; "we already know it".
3. **F3:** Restore from `history.watchedSeconds`, clamped to duration.
4. **F6:** Channel tags (auto-apply) **+** per-video tags **+** an "apply to all
   future videos of this channel" promote action. Shown as a bottom "Tags:" row on
   the loaded summary; add/remove/promote there. Affects both prompt paths.
5. **F7:** Parked — revisit later (no backend/paid decision now).
