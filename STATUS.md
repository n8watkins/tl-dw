# TL;DW Extension — Status

**Version:** 0.1.156
**Last updated:** 2026-06-20

---

## What's built

### 1. Core Direct API flow
- Headless Gemini REST call on YouTube navigation — no destination tab opened.
- `---TLDW---` block parsed from the response: VERDICT / SUMMARY / RATING / DETAILS.
- Widget injected into the YouTube page with a shimmer loading state.
- Auto-run trigger: fires when a video exceeds the configured minute threshold.
- One Gemini API call per video — no secondary calls.

### 2. Open-in-a-tab flow (no API key)
- Opens Gemini / ChatGPT / Claude / NotebookLM with the prompt filled
  and submitted, using whatever account you're signed into.
- For AIs that can't watch the video, the extracted transcript is attached.
- TL;DW reads the finished answer back out of the tab and drops the summary onto
  the YouTube page; falls back to copying the prompt if the composer can't be
  filled. Auto-fill failures surface in the popup (`DeliveryStatus`).
- "Open tab" button focuses the already-scraped tab instead of spawning duplicates.

### 3. Engagement tracking (auto-rating)
- A watch-time engine (`watchtime.ts`) measures content-seconds actually watched.
- Videos are auto-rated **Engaged / Skimmed / Skipped** from watch percentage
  (`engagedPct` / `skimmedPct` thresholds) — replaced the old manual rating buttons.
- Per-channel engagement averages computed locally (no API call).

### 4. SponsorBlock auto-skip
- Skips in-video sponsored segments using the free community SponsorBlock data
  (`sponsorblock.ts`, `sponsor.ajay.app`).
- Inline widget shows segments with clickable timestamps + Undo on auto-skip.
- Lifetime skip count + seconds-saved tallied into stats.

### 5. Stats dashboard (neon)
- Lifetime counters (`tldwStats`, never pruned): summaries, cache hits, watch time,
  sponsor skips + seconds saved, Engaged/Skimmed/Skipped totals.
- Activity heatmap (last 12 weeks / 84 days) from daily summary counts; the daily
  activity map is retained for up to 366 days in storage.
- **Week/month/year/all-time dashboards** (`src/lib/dashboards.ts`, F7 Phase 1,
  merged in PR #2): a window toggle on the Stats page with vs-previous-window delta
  chips, finish-rate donut, time-given-back, and a block-nudge card.

### 6. Channel tracking + comparison
- `channel` and `channelAvatarUrl` stored on every `SearchHistoryEntry`.
- `computeChannelStats()` groups history by channel for avg AI rating + engagement
  — all local arithmetic, no LLM.
- Widget shows a `📊 vs channel` row with avg score and ▲/▼/≈ trend.
- **Channels page** in options: avatar cards, AI score pills, sort (most watched /
  highest rated / recent), expandable per-channel video lists.
- Per-channel **block** and **auto-run** lists.

### 7. Direct API settings
- Profile picker independent of the global default (`directApiProfileId`).
- Daily quota bar (today's calls / 500 RPD free tier), color-coded.
- Per-call log (metadata-only by default; `keepFullCallLog` retains prompt+response).

### 8. History management
- Auto-expire entries older than a configurable number of days (7/30/90/365),
  pruned on write and on startup.
- Manual history limit (50 / 100 / 250 / unlimited).
- Clear usage with confirmation; permanent all-time call counter survives clears.
- History stores a transcript-free prompt only (storage-quota discipline).

---

## Known bugs / open threads

### Medium priority

**Avatar URL expiry**
YouTube avatar URLs embedded in `src` are signed CDN URLs that can expire. Current
mitigation: `onError` falls back to a color-hash initial. But stale URLs sit in
storage forever, so every Channels page load fires broken image requests before
falling back. Needs a de-dup / refresh strategy.

### Low priority

**Popup has no channel context**
The Channels page shows per-channel stats but the popup (shown while browsing
YouTube) has no awareness of them. A "You've watched 4 videos from this channel,
avg AI 7.2" line in the popup would close that gap.

---

### Resolved (correctness campaign, 2026-06-19)

The last ~11 commits closed a 56-issue correctness campaign — these classes are
no longer open: chrome.storage read-modify-write races (now serialized via Web
Locks, `src/lib/storage.ts`), SPA nav-epoch / videoId staleness (stale summaries
and panels for the video you left), Direct-API parser robustness (bold labels,
truncation, multi-block, value mangling), the dead AI RATING cue (revived),
transcript prompt-injection (fenced), watch-time double-count + seek-counting,
and assorted React state bugs. Gated by typecheck + 101 unit tests + production
build.

## Architecture notes

| Layer | Key files |
|---|---|
| Types | `src/types/index.ts` |
| Background orchestrator | `src/background/index.ts` |
| YouTube content script (~2.7k LOC) | `src/content/youtube.ts` |
| MAIN-world fetch interceptor | `src/content/youtube-intercept.ts` |
| Watch-time engine | `src/content/watchtime.ts` |
| SponsorBlock | `src/content/sponsorblock.ts` |
| Destination auto-fill | `src/content/inject.ts` |
| Library helpers | `src/lib/` (history, storage, profiles, engagement, promptBuilder, tldw, dashboards, constants) |
| Options UI | `src/options/sections/` |

Tests: 101 Vitest cases over the pure helpers (engagement 21, stats 18, dashboards 14,
history 13, promptBuilder 13, tldw 12, profiles 10 — the stats suite imports its
helpers from `storage.ts`). DOM/content-script and React UI remain untested.

See `LESSONS_LEARNED.md` for the hard-won Chrome-extension patterns this project
established.

---

## Not doing

- **Key moments** (transcript-derived timestamps surfaced in the widget) —
  explicitly killed, code removed. Don't revisit.
- **YouTube Data API** — DOM-scraping / intercepted network data only.

---

## Chrome Web Store launch

Prep is well underway (see [`docs/PUBLISH_CHECKLIST.md`](docs/PUBLISH_CHECKLIST.md)
for the live checklist and [`docs/STORE_SUBMISSION.md`](docs/STORE_SUBMISSION.md)
for the paste-ready listing copy + permission justifications). **Done:** MIT
`LICENSE`, `PRIVACY.md`, `NOTICE`, `CONTRIBUTING.md`, a full compliance audit
(49 pass, 0 code/policy blockers), the rejection-risk hardenings (key→header,
dropped `chat.openai.com` + `m.youtube.com`, first-run consent notice), and
`npm run package`. **Remaining (hard blockers, user-made):** ≥1 screenshot
(1280×800) + the 440×280 promo tile; then the $5 dev account + 2-Step Verification.

## Other potential next steps

1. Avatar URL de-duplication / refresh strategy.
2. Popup channel context card.
3. Optional pre-launch polish: bump to `1.0.0`; neutralize the bundled third-party
   brand logos; live-key test of the Direct-API header change.
4. Consider splitting `youtube.ts` (~2.7k LOC) into panel / nav-mount / scrape modules.

The F1–F8 feature sprint (overflow menu, channel-average cue, persisted watch
tracking, fill-hover, prose tightening, tags, regenerate) and F7 Phase 1
(week/month/year dashboards) have all shipped and merged; their plans are archived
under `docs/archive/`. The one genuinely open bet is **F7 Phase 2 — paid / hosted
analytics**, still undecided (see `docs/archive/F7_PHASE1_PLAN.md` §0 for the
"don't charge for local data" reasoning).
