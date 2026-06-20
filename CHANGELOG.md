# Changelog

Notable changes to TL;DW. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

> **On version numbers:** `npm run build` auto-increments the patch version on every
> build (so the popup version always changes on reload). The patch number therefore
> tracks builds, not releases — this changelog records the **notable feature
> milestones**, not every patch. Full commit-level history is in git, and completed
> planning docs live in [`docs/archive/`](docs/archive/).

## 0.1.156 — 2026-06-20

### Added
- **F7 Phase 1 — week/month/year/all-time dashboards** on the Stats page
  (`src/lib/dashboards.ts`): window toggle, vs-previous-window delta chips,
  finish-rate donut, "time given back", and a block-nudge card.

### Changed
- Documentation pass: corrected the unit-test count (now **101**), the activity
  heatmap window (12 weeks / 84 days), the `src/lib/` helper list, and stale F7
  status across the docs. Moved completed planning docs into `docs/archive/`.
- Added `LICENSE` (MIT), `NOTICE` (third-party attribution), `PRIVACY.md`, and this
  changelog.

## Earlier milestones

(Version-by-version detail is in git history; these are the major eras.)

### Feature sprint (F1–F8)
Overflow (kebab) menu, per-channel-average engagement cue, persisted watch-%
tracking, fill-on-hover pills, filler-free prose directive, per-channel **tags**
(channel ∪ video), and a force-rerun **Regenerate** action.

### Correctness campaign
Closed a large batch of correctness issues: `chrome.storage` read-modify-write races
(now serialized via Web Locks), SPA nav-epoch / videoId staleness, Direct-API parser
robustness, transcript prompt-injection fencing, and watch-time double-counting.

### Engagement, sponsors & stats
- **Engagement tracking** — watch-time engine auto-rates videos Engaged / Skimmed /
  Skipped, with per-channel averages.
- **SponsorBlock auto-skip** — skip in-video sponsor segments from the free community
  data, with inline timestamps, Undo, and lifetime seconds-saved.
- **Stats dashboard** — lifetime counters and an activity heatmap.
- **Channels page** — avatar cards, AI-score pills, sort, and per-channel block /
  auto-run lists.

### Direct API mode
Headless Gemini REST call on navigation that renders the verdict + summary in an
on-page widget (no destination tab), with a daily quota bar (~500 RPD free tier) and
a metadata-only-by-default call log.

### Multi-destination & transcript era
Send to Gemini, ChatGPT, Claude, or NotebookLM with auto-fill + auto-submit and a
graceful clipboard fallback; transcript extraction via intercepted InnerTube/timedtext
network data with a DOM-scrape fallback; the worth-watching verdict gate;
transcript-free history with opt-out auto-expiry.
