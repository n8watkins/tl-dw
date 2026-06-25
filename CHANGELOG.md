# Changelog

Notable changes to TL;DW. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

> **On version numbers:** `npm run build` auto-increments the patch version on every
> build (so the popup version always changes on reload). The patch number therefore
> tracks builds, not releases — this changelog records the **notable feature
> milestones**, not every patch. Full commit-level history is in git, and completed
> planning docs live in [`docs/archive/`](docs/archive/).

## 0.1.164 — 2026-06-25

### Added
- **Inline TL;DW button in the subscribe row** — replaces the always-on idle box;
  the action now lives next to Subscribe and shows its own loading state.
- **Channels page tabs + search** — an *All channels* / *Auto-summarize* tab split
  with name/tag search, and **virtualized lists** (`@tanstack/react-virtual`) so
  large channel lists stay smooth.
- **Per-channel stats** — time-spent and engagement are now tracked and persisted
  per channel.
- **Support / About refresh** — support repointed from Buy Me a Coffee to
  **Ko-fi** (https://ko-fi.com/n8watkins) and now also plugs
  **n8builds.dev** (https://n8builds.dev) and **Appturnity**
  (https://appturnity.com/); the version moved to the sidebar/header and About.

### Changed
- **Channel tags are now keyed by channel name** (rather than the prior key).
- Popup: shorter first-run sponsor notice, four destinations, and a Ko-fi link.
- Documentation pass: corrected the unit-test count (now **113**).

### Removed
- **Block-channel feature removed entirely** — the blocked-channels lists and the
  block-nudge card (advertised in 0.1.156) are gone. Orphaned
  `tldwBlockedChannels` storage is cleaned up on startup.
- **Perplexity destination removed** — the open-in-a-tab destinations are now
  **Gemini, ChatGPT, Claude, and NotebookLM** (four total).
- **Always-on idle box and loading skeleton removed** — loading lives on the new
  inline button instead.
- **`src/assets/claude-icon.png` removed** — all four destination icons are now
  inline Simple Icons SVG paths in `DestinationIcon.tsx`.

### Fixed / performance
- Fixed a tag-map memory leak, added a poll fast-path, and added storage
  quota-comment clarifications.
- Added a video-tag sweep alongside the orphaned blocked-channels cleanup.

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

### Chrome Web Store readiness
- Gemini API key now sent via the `x-goog-api-key` header instead of the URL.
- Dropped the unused `chat.openai.com` and the desktop-only `m.youtube.com` hosts
  (manifest now requests 7 host permissions, all exercised).
- Tightened the transcript `postMessage` target to `location.origin`.
- Added a first-run popup notice disclosing SponsorBlock + engagement tracking,
  with a one-click path to turn them off.
- Added `CONTRIBUTING.md`, `docs/STORE_SUBMISSION.md`, `docs/PUBLISH_CHECKLIST.md`,
  and an `npm run package` step that builds the uploadable store zip.

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
