# Splitting TL;DW: a separate "YouTube Usage Analytics" extension

> Exploration doc. The idea: TL;DW is fundamentally a **pre-watch** tool ("should
> I watch this?") while the per-channel stats / watch-time / engagement layer is a
> **post-watch** tool ("what have I been watching?"). They're opposite jobs that
> accreted into one extension. This doc inventories what we have, classifies it,
> outlines a two-extension split, summarizes the competitive landscape, and —
> the key section — analyzes how the split changes our tech-debt/hardening posture.
>
> _Decision dropped per the user (2026-06-25): F7 Phase 2 (paid/hosted analytics)
> is off the table. The analytics extension is local-only and free._

---

## 1. Feature classification — S (summarizer) / A (analytics) / Shared

**Summarizer (stays in TL;DW):** inline TL;DW button + summary panel · transcript
scrape (`youtube.ts`, `youtube-intercept.ts`) · prompt builder + profiles + tags ·
Gemini Direct API + call log + usage · destination-tab flow + injector
(`inject.ts`) · worth-watching gate · summary cache · auto-run channels (trigger) ·
Setup/DirectApi/Profiles/Tags/Support/About options.

**Analytics (moves to the new extension):** watch-time engine (`watchtime.ts`) ·
engagement verdict logic (`engagement.ts`) · `recordWatchProgress` · lifetime +
per-channel stats (`tldwStats`) · dashboards (`dashboards.ts`, `stats.ts`) ·
StatsSection · ChannelsSection · the watch-log half of HistorySection · SponsorBlock
*tracking* (the skip counters; the auto-skip itself is arguably summarizer-side).

**Shared infrastructure (needed by both):** channel-info scraper +
video-meta reader (in `youtube.ts`) · `withWriteLock` + storage RMW helpers ·
engagement verdict logic · type stubs · theming + component library (Button,
Dialog, Icons, **VirtualList**) · the Vite/crxjs/TS build setup.

### Storage-key ownership
| Key | Owner |
|---|---|
| `profiles`, `tldwSummaryCache`, `geminiUsage`, `geminiCallLog`, `tldwTags`, `tldwChannelTags`, `tldwVideoTags`, `autoRunChannels`, `pendingPrompts`, `openSearches`, `deliveryStatus` | **Summarizer** |
| `tldwStats` (global + `channels`) | **Analytics** |
| `settings` | **Split** — summarizer keys (destination, profiles, gate…) vs analytics keys (`trackEngagement`, `engagedPct`, `skimmedPct`, `showEngagementStatus`) |
| `history` | **Conflated** — see §5: it mixes "I summarized this" (prompt/profile/destination) with "I watched this" (watchedSeconds/userRating/duration). The split forces separating these. |

---

## 2. Split architecture

- **TL;DW (summarizer):** ~65% of today's code, minus the stats/channels/dashboards
  UI and the watch-time→stats write path. Leaner, single-purpose.
- **YouTube Usage Analytics (new):** ~50% **cloned** from current code — `watchtime.ts`,
  `engagement.ts`, `stats.ts`, `dashboards.ts`, the per-channel stat logic in
  `storage.ts`, and adapted Stats/Channels/History UI + the channel-info scraper.
  No Gemini, no destination flow. Local-only, no backend.
- **The decision that makes or breaks it (see §6): a shared package.** Put the
  scraper, `withWriteLock`, engagement logic, types, theming, and build config in a
  shared workspace package (npm/pnpm workspaces, e.g. `@tldw/core`) that **both**
  extensions import. Without it, the split is two copy-paste forks that drift.

---

## 3. Competitive landscape (researched 2026-06-25, cited)

**Direct competitors (per-channel watch analytics) are few, tiny, or buggy:**
- **Watchtime Tracker** — 10k installs, 4.3★/127. Market leader; multi-platform
  (Twitch) + cross-device sync. Weakness: recurring **accuracy bugs, resets, sync
  failures**.
- **YouTube Time Manager** — 8k installs; gamified ranks + pie-chart channel
  breakdown. Dinged for accuracy bugs, icon-flash, **ads, high CPU**.
- **YouTube Watch Stats** — only ~522 installs but the **closest match**: live,
  local-only, date-range charts, top channels + videos, **Shorts-vs-long split**.
  Proves the concept and feasibility while leaving the market wide open.
- Takeout-based **web apps** (youtubewatchhistoryanalysis.com, playbackstats.com,
  Ajay Ramachandran's viewer) have full historical data but are static one-time
  uploads, not live, no engagement signal.

**Adjacent:** time-trackers (StayFree 200k, Webtime 90k, Web Activity 30k) bucket
time by **domain** — `youtube.com` is one slice, never per-channel. Feed-blockers
(Unhook **1M**, Remove/No-Shorts 100–300k each) **strip the feed but measure
nothing**. YouTube's native "Time Watched" is **mobile-only and total-time-only**.

**The white space (our wedge):** per-channel, **engagement-aware** ("which channels
do I finish vs abandon"), **live + local**, **desktop**, with a **Shorts-vs-long-form
split** — nobody with real adoption does this. Distribution (1M+ on adjacent tools)
and monetization (DF Tube went paid; ShortsBlocker sells "time-saved" stats) are
both proven.

**Caveats:** YouTube shipped its own **Recap** (Dec 2025, Wrapped-style, breaks out
Shorts annually) and a **native Shorts daily limit** (Oct 2025) — so don't build
"yet another yearly wrapped"; lead with always-on, finer-grained, exportable,
local insight. Expressed demand skews toward "help me **stop**" (Shorts/"brain rot"
— APA Sept 2025 review of 71 studies), so pairing the Shorts quantifier with a
limit/nudge matches the need better than measurement alone.

---

## 4. Data-access reality (feasibility — verified)

- **The YouTube Data API removed watch-history access on 2016-09-12.** There is no
  official API for a user's watch history today. Every viable tool observes the
  browser or imports Takeout.
- **Three sources:** (1) **DOM/watch-time observation** as the user browses — what
  TL;DW already does; live but **only captures videos watched while installed (no
  backfill)**; (2) **Google Takeout** `watch-history.json` — ToS-clean, full history,
  but manual/async, defaults to HTML, and has **no watch durations**; (3) InnerTube
  interception — highest quality, highest ToS risk.
- **Best practice = the SponsorBlock pattern:** observe-only, local-only, no backend,
  no scraping of `/feed/history` via auto-pagination. Sidesteps most ToS/privacy
  concerns. Sending watch data to a server/LLM re-introduces them (CWS Limited Use).
- **Conclusion:** the proposed architecture (reuse TL;DW's on-the-fly observation +
  optional Takeout import for history) is technically sound and the **lowest-risk**
  path. The "no historical backfill" limit is inherent and must be communicated.

---

## 5. New decisions the split forces

1. **Shared package or fork?** (see §6 — pick the package.)
2. **`history` data-model split:** separate "summarize log" (summarizer) from
   "watch log" (analytics). `SearchHistoryEntry` currently conflates them.
3. **Migration:** chrome.storage is **per-extension** — the new extension starts
   with an empty store and **cannot read TL;DW's `tldwStats`/`history`**. Need a
   one-time **export-from-TL;DW → import-into-Analytics** bridge (JSON), and/or
   Takeout import. Without it, every existing TL;DW user's accumulated stats are
   stranded.
4. **Dual-install behavior:** if both are installed, two content scripts both
   observe playback (double DOM work + writes). Decide: TL;DW **drops its watch-time
   engine** (keep at most a lightweight in-panel cue, or drop the cue), so only
   Analytics observes.

---

## 6. ★ Tech-debt & hardening impact (the core question)

How the split changes each open tech-debt / hardening item:

| Item (effort) | Effect of the split |
|---|---|
| **Split `youtube.ts` (~2.5k LOC)** (L) | **✅ Resolved by construction.** The split *forces* the decomposition: summarizer keeps panel/transcript/SponsorBlock/inject; analytics takes watch-time + channel-info scraper. Our single biggest debt item is paid off as a side effect. |
| **Watch-path = 2 RMW writes/fire** (M) | **✅ Decoupled.** `recordWatchProgress` today writes `history` (summarizer) **and** `tldwStats` (analytics) in one function under two locks. After the split, Analytics owns watch-time and writes **only its own stats**; the summarizer's search-log is written separately on summarize. The "two unrelated writes coupled in one hot function" dissolves. |
| **Redundant `computeChannelStats` on the Direct-API path** (S) | **✅ Likely removed.** It exists only to compute the in-panel "channel average" cue. If channel analytics leaves, the summarizer drops that cue (or it becomes an Analytics feature) and the redundant calls go with it. |
| **`historyLimit:"unlimited"` has no ceiling** (S) | **✅ Clarified.** Today `history` is the unbounded churning key because the watch engine adds a stub per watched video. After the split, **Analytics owns the watch-log** (the real growth) and can cap it as core data; the **summarizer's history shrinks to a slow-growing summarize-log** (grows only when you summarize). The unbounded concern moves to where it's the product and gets a proper cap. |
| **`geminiCallLog` byte-uncapped** (S) | ➖ Unaffected — pure summarizer concern, now isolated in a smaller codebase. |
| **Per-channel stats: no backfill** (S) | **⚠️ Worse / new work.** Separate extensions have **isolated storage**, so Analytics starts at zero AND can't inherit the stats current TL;DW users already have. Forces the **export/import migration bridge** (§5.3). |
| **`videosWatched` approximate** (declined) | Moves to Analytics; unchanged. |

### New debt the split introduces (must be planned for)
- **A. Shared-code drift.** Both need the scraper, `withWriteLock`, engagement
  logic, types, theming, build. A YouTube-DOM fix in two places = drift.
  **→ Mitigation: the shared `@tldw/core` workspace package. This is the decision
  the whole split hinges on.**
- **B. Cross-extension isolation.** No shared storage; runtime coupling needs
  `externally_connectable` (fragile, both-installed). **→ Keep them independent;
  bridge only via one-time export/import.**
- **C. History/watch-log data-model separation** (§5.2) — a real but clarifying
  refactor.
- **D. Double observation for dual-install users** (§5.4) — decide who observes.

### Verdict
**Net positive — if paired with a shared package.** Done right (monorepo + shared
core), the split pays off our #1 debt item (`youtube.ts`), decouples the
watch-path RMW, removes the channel-stats redundancy, and leaves **two small,
single-purpose, easier-to-harden codebases**. Done as a naive copy-paste fork, it
**doubles** the infra debt and adds migration pain — strictly worse than the
monolith. So the hardening question reduces to one prerequisite: **stand up the
shared library first, then split.**

---

## 7. Suggested sequencing (if we proceed)
1. **Set up the monorepo + `@tldw/core` shared package** (scraper, write-lock,
   engagement, types, theming, build) — extract from current code in place; TL;DW
   keeps working. *This is also the clean way to do the `youtube.ts` split.*
2. Decide the **history → summarize-log vs watch-log** data-model split.
3. Scaffold the **Analytics extension** importing `@tldw/core`; clone watch-time +
   stats + dashboards UI; add a **Takeout importer** + an **export/import bridge**
   from TL;DW for migration.
4. Slim TL;DW: remove the stats/channels UI and the watch-time→stats write path
   (keep at most a light in-panel cue); drop the redundant channel-stats compute.
5. Position Analytics on the white space: per-channel **engagement** + **Shorts
   split**, live + local, optional limit/nudge.
