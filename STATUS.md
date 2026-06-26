# TL;DW Extension — Status

**Version:** 0.1.164
**Last updated:** 2026-06-25

> **Scope (2026-06-25):** TL;DW is now a focused **YouTube summarizer**. Its stats
> are **summary-centric** (how much you've *summarized*, not how much you've
> *watched*). The post-watch **watch-time + engagement analytics are being split
> out** into a separate local-only companion extension ("Watchprint", scaffolded at
> `../watchprint`); see [`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md) for the
> rationale and plan. The watch-time engine **still runs under the hood** (pending
> removal) but is no longer surfaced in the UI — only the analytics *display* was
> removed. The on-page summary panel + SponsorBlock auto-skip are unchanged.

---

## What's built

### 1. Core Direct API flow
- Headless Gemini REST call on YouTube navigation — no destination tab opened.
- `---TLDW---` block parsed from the response: VERDICT / SUMMARY / RATING / DETAILS.
- An inline **"TL;DW" button** mounted in YouTube's subscribe row (next to vidIQ)
  runs the summary on click; the button shows "Analyzing…" while in flight (the
  always-on idle box and the loading skeleton panel are gone). The summary renders
  in an injected widget; errors/timeouts still surface in an error panel.
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

### 3. Watch-time engine (under the hood, no longer surfaced)
- A watch-time engine (`watchtime.ts`) still measures content-seconds actually
  watched, auto-rates videos **Engaged / Skimmed / Skipped** (`engagedPct` /
  `skimmedPct` thresholds), and rolls up per-channel averages locally.
- **As of the 2026-06-25 re-scope this data is no longer displayed anywhere** — the
  engagement/watch-time dashboards were removed from the UI. The engine is left
  running **pending removal**; it (and the rest of the watch-behavior analytics)
  moves to the **Watchprint** companion extension. See
  [`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md).

### 4. SponsorBlock auto-skip
- Skips in-video sponsored segments using the free community SponsorBlock data
  (`sponsorblock.ts`, `sponsor.ajay.app`).
- Inline widget shows segments with clickable timestamps + Undo on auto-skip.
- Lifetime skip count + seconds-saved tallied into stats.

### 5. Stats dashboard (neon, summary-centric)
- **Summary-centric counters:** **# summaries created**, **cache hits**, and
  **summarized-today**. (Watch-time, time-saved, and Engaged/Skimmed/Skipped totals
  are still tallied in `tldwStats` under the hood but are **no longer displayed.**)
- **GitHub-style summary-activity heatmap** (year-long contribution grid built from
  daily *summary* counts) + a consecutive-day **summary streak**.
- **Top channels by # summaries** (most-summarized first).
- **Profile usage distribution** — summaries grouped by prompt profile.
- **Destination usage distribution** — summaries grouped by destination (Direct API
  vs each open-in-a-tab AI).
- **Most-used tags** across channel + video tag assignments.
- **Removed from the UI in the 2026-06-25 re-scope:** the week/month/year windowed
  engagement dashboards, the finish-rate/engagement donut, time-given-back, the
  watch-based activity heatmap, and the AI-rating sort. Those move to **Watchprint**
  (see [`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md)).

### 6. Channel tracking (summary-centric)
- `channel` and `channelAvatarUrl` stored on every `SearchHistoryEntry`.
- `computeChannelStats()` groups the **summary** history by channel — all local
  arithmetic, no LLM.
- Channel tags are keyed by channel **name** (was channel id).
- **Channels page** in options: **tabbed** (All channels / Auto-summarize) with
  **search by name + tag**, avatar cards, and a sort of **Most summarized** /
  Recently summarized. Each channel card shows **# summaries · last summarized ·
  tags**. The channel and expanded-video lists are **virtualized** for long
  histories.
- Per-channel **auto-summarize** list.
- The on-page panel's `📊 vs channel` engagement cue and the per-channel
  watch-time / engagement display were **removed in the 2026-06-25 re-scope** (the
  watch-time engine that fed them still runs under the hood pending its move to
  **Watchprint** — see [`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md)).

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
and assorted React state bugs. Gated by typecheck + 113 unit tests + production
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

Tests: 113 Vitest cases over the pure helpers (engagement 21, stats 30, dashboards 14,
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
`npm run package`. The current build is **0.1.164**. **Remaining (hard blockers,
user-made):** ≥1 screenshot (1280×800) + the 440×280 promo tile; then the $5 dev
account + 2-Step Verification.

## Other potential next steps

1. **Finish the analytics split** — remove the now-headless watch-time engine
   (`watchtime.ts`) + the residual `tldwStats` watch/engagement writes once
   **Watchprint** (`../watchprint`) takes over, and stand up the migration bridge.
   Plan in [`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md) and
   `../watchprint/PLAN.md`.
2. Avatar URL de-duplication / refresh strategy.
3. Popup channel context card.
4. Optional pre-launch polish: bump to `1.0.0`; the bundled `claude-icon.png` is
   already gone (all four destination marks are now inline SVG in
   `DestinationIcon.tsx`), so only the remaining third-party SVG marks would need
   neutralizing if desired; live-key test of the Direct-API header change.
4. Consider splitting `youtube.ts` (~2.7k LOC) into panel / nav-mount / scrape modules.

The F1–F8 feature sprint (overflow menu, channel-average cue, persisted watch
tracking, fill-hover, prose tightening, tags, regenerate) and F7 Phase 1
(week/month/year dashboards) all shipped and merged; their plans are archived
under `docs/archive/`. The **2026-06-25 UX revision + perf pass** shipped the
inline subscribe-row TL;DW button (idle box + loading skeleton removed), end-to-end
removal of the block-channel feature, and the tabbed/searchable/virtualized Channels
page. The later **2026-06-25 re-scope** then narrowed TL;DW to a focused summarizer:
the Stats and Channels pages became **summary-centric** (the watch-time/engagement
dashboards, F7 windowed view, donut, watch-based heatmap, and AI-rating sort were
removed from the UI), and the watch-behavior analytics began moving to the
**Watchprint** companion extension (`../watchprint`,
[`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md)). **F7 Phase 2 (paid / hosted
analytics) is off the table** — Watchprint is local-only and free (the "don't charge
for local data" reasoning is in `docs/archive/F7_PHASE1_PLAN.md` §0).
