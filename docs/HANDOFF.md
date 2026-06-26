# Handoff — TL;DW

Zero-context handoff. Read this + [`STATUS.md`](../STATUS.md) +
[`docs/PUBLISH_CHECKLIST.md`](PUBLISH_CHECKLIST.md) first; they answer most
questions — don't re-ask the user what they already decide here.

_Last updated: 2026-06-25._

## Project summary

**TL;DW** ("Too Long; Didn't Watch") is a **Manifest V3 Chrome extension** — now a
focused **YouTube summarizer**. It summarizes the YouTube video you're watching so
you can decide if it's worth your time. Two modes: **Direct API** (your own free
Gemini key → summary rendered on the YouTube page, no tab opens) and
**open-in-a-tab** (Gemini/ChatGPT/Claude/NotebookLM, prompt auto-filled + submitted,
answer read back onto the page). Plus SponsorBlock auto-skip and **summary-centric
stats** (# summaries created, top channels by summaries, profile/destination usage,
most-used tags, and a GitHub-style summary-activity heatmap + streak). **No backend,
no accounts, no analytics** — everything is local.

> **The split is DONE on TL;DW's side (2026-06-25).** The post-watch **watch-time +
> engagement analytics moved out** to a separate local-only companion extension,
> **Watchprint** (its own repo `github.com/n8watkins/watchprint`, local at
> `../watchprint` — steps 1–3 done; it now captures watch-time + engagement). On TL;DW:
> - **Stats / Channels are summary-centric** — no watch-time/engagement display.
> - **The watch-time engine `watchtime.ts` is DELETED**, the `WATCH_PROGRESS` recorder
>   is gone, and **the on-page panel is summary-only** — no AI WATCH/SKIM/SKIP verdict
>   pill and no `📊 vs channel` engagement cue (decoupled in `93f8b7b`). TL;DW no longer
>   tracks watch-time/engagement at all (a data-collection reduction — privacy win).
> - ⚠️ **Orphaned dead code pending a cleanup pass:** `src/lib/engagement.ts`,
>   `recordWatchProgress` + the per-channel stat helpers in `storage.ts`, the per-channel
>   helpers in `stats.ts`, `dashboards.ts`, and the watch/engagement fields on the types
>   are no longer wired to anything (left in place to avoid a cascade). See Next Steps B3.
> The summary panel, SponsorBlock auto-skip, profiles, and tags are unchanged. Full
> rationale / feature-map / migration: [`ANALYTICS_SPLIT.md`](ANALYTICS_SPLIT.md) +
> `../watchprint/HANDOFF.md`.

- **Stack:** TypeScript + Vite + `@crxjs/vite-plugin`; React for popup/options,
  vanilla TS for content scripts. Vitest for unit tests.
- **Repo:** `github.com/n8watkins/tl-dw` (public), branch `master`.
- **Local path:** `~/projects/extensions/tldw` (moved from `~/n8builds/...` this
  session).
- **Run:** `npm run dev` (live dev). `npm run build` bumps the patch version and
  rsyncs `dist/` to `/mnt/c/Users/natha/Projects/Tools/tldw` (the Windows
  load-unpacked folder). `npm run package` builds the clean Web Store zip
  (`web-store/tldw-<version>.zip`, no version bump, no Windows copy).
- **Gate (run before every commit):** `npm run typecheck` && `npm test` (**113
  tests**). For UI/content-script changes also walk [`SMOKE_TEST.md`](SMOKE_TEST.md).

## State

**This session (all committed + pushed):**

| Commit | What |
|---|---|
| `d471348` | Doc evaluation: fixed stale facts (test count 79→**101**), archived completed planning docs to `docs/archive/` |
| `1598301` | Added `LICENSE` (MIT), `NOTICE`, `PRIVACY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` |
| `f690863` | Folder relocation: fixed `.local-ops.yaml` path |
| `779ee5e` | Web Store prep: `docs/STORE_SUBMISSION.md`, `npm run package`, dropped `chat.openai.com`, tightened `postMessage` origin |
| `8a88a2d` | Submission-guide accuracy fixes (per compliance audit) |
| `21be53a` | Hardenings: Gemini key → `x-goog-api-key` header; dropped `m.youtube.com`; first-run consent notice |
| `73be4a6` | `docs/PUBLISH_CHECKLIST.md` + staleness fixes from the host-scope change |
| `ec23721` | This handoff doc (zero-context session handoff) |

**Updated 2026-06-25:** a follow-up session shipped the UX revision + perf/virtualization
pass (~10 commits, `88098e5`…`c1bc979`) on top of the table above:

| Commit | What |
|---|---|
| `88098e5` | Inline "TL;DW" button in the subscribe row; dropped the always-on idle box |
| `bf03ef5` | UX revision plan (`docs/UX_REVISION_PLAN.md`) |
| `c249eba` | UX revision batch — removed channel blocking, button-only loading, options polish |
| `8f6ac27` | Review fixes — stuck-Analyzing on host miss, broken channel-tag lookup, search dead-end |
| `acd4f54` | Review fixes — loading-cue mount, orphaned block-storage cleanup, honest videosWatched |
| `44f9614` | Memory + performance/optimization audit (`docs/PERF_MEMORY_AUDIT.md`) |
| `1acf1fa` | Top memory/optimization fixes (tag-map leak, poll, icon, comments) |
| `30a4c07` | Virtualize Channels + History lists (dynamic-height, search-aware) |
| `004adf0` | Virtualize the expanded channel video list |
| `c1bc979` | In-Chrome verification checklist for this session's UX changes |

**The split (2026-06-25, on top of the above):**

| Commit | What |
|---|---|
| `728fbc6` | Analytics-split exploration doc (inventory, competitive research, tech-debt) |
| `dd34755` | Re-scope Stats + Channels to **summary-centric** (drop watch/engagement display) |
| `1f168b5` | Summary-activity heatmap + streak + profile/destination distributions |
| `1f3a1bb` | Re-scope copy + docs to "focused YouTube summarizer" |
| `7aefe88` | Stats review fixes (heatmap cap 366→400, today count, stale copy) |
| `93f8b7b` | **Decouple watch-time/engagement** — delete `watchtime.ts`, panel is summary-only |

Net effect: version is now **0.1.171**, **113** unit tests, **4** destinations
(Gemini/ChatGPT/Claude/NotebookLM — Perplexity removed), the block-channel feature
is gone end-to-end (a one-time orphan-key cleanup of `tldwBlockedChannels` remains
in `background/index.ts`), `claude-icon.png` is deleted (all four marks are inline
SVG in `DestinationIcon.tsx`), the Channels page is tabbed/searchable/virtualized,
and support repointed to Ko-fi (`ko-fi.com/n8watkins`) + `n8builds.dev` + Appturnity
(`appturnity.com`). The later **2026-06-25 re-scope** then made the Stats + Channels
pages **summary-centric** (Channels now shows # summaries · last summarized · tags,
sorted Most summarized) and pulled the watch/engagement dashboards out of the UI as
step one of the Watchprint split — see the re-scope note above.

**Verified working:** `npm run typecheck` clean, **113/113** Vitest tests pass,
`npm run package` builds a valid zip (manifest at root, 7 host permissions). A full
**Chrome Web Store compliance audit** passed: 49 requirements pass, **0 code/policy
blockers**.

**Needs live verification (couldn't be unit-tested — content/UI code):**
1. **Direct API** with a real Gemini key — the key moved to the `x-goog-api-key`
   header (`src/background/index.ts` `callGeminiApi`); confirm a summary still
   returns.
2. **First-run popup notice** renders and dismisses (`src/popup/App.tsx` ~L318).

## Next steps

### A. Finish the Chrome Web Store launch (active thread)
Tracked in [`PUBLISH_CHECKLIST.md`](PUBLISH_CHECKLIST.md). Only **user-made**
blockers remain:
1. Create **≥1 screenshot (1280×800)** + the **440×280 promo tile** (briefs in
   [`STORE_SUBMISSION.md` §5](STORE_SUBMISSION.md)). *These are the only hard
   blockers.*
2. Dev account: **$5** + **2-Step Verification** + verified email.
3. Run the two live verifications above, then `npm run package`, paste the listing
   fields from `STORE_SUBMISSION.md`, set visibility, **submit**.
- **Decision pending (user):** bump version `0.1.171` → `1.0.0` for the public
  listing (cosmetic).
- **Now even cleaner for review:** the decoupling removed the watch-time tracking, so
  TL;DW collects *less* user data than the audited build — re-verify STORE_SUBMISSION /
  PRIVACY disclosures match (already updated in `93f8b7b`).

### B. Feature development (post-launch roadmap)
From [`STATUS.md`](../STATUS.md) and the audits, in rough priority:
1. **Avatar URL refresh/de-dup** — YouTube avatar CDN URLs in storage expire and
   fire broken image requests before the `onError` color-hash fallback. Needs a
   refresh/de-dup strategy. Files: `src/options/sections/ChannelsSection.tsx`,
   `src/options/sections/StatsSection.tsx`, storage avatar fields. *Accept:* stale
   URLs don't cause visible broken-image flashes; avatars refresh.
2. **Popup channel context card** — the popup has no per-channel awareness while
   browsing. Add a summary-scoped line (e.g. "you've summarized N videos from this
   channel"); keep it summary-centric, not watch/engagement (that signal is leaving
   for Watchprint). Files: `src/popup/App.tsx`, `src/lib/` channel stats helpers.
3. **Dead-code cleanup + migration (the split's remaining TL;DW work).** The watch-time
   engine is already deleted and the engagement display is gone (`93f8b7b`); what
   remains is to **remove the now-orphaned data-layer modules** — `src/lib/engagement.ts`,
   `recordWatchProgress`/`bumpChannelStat`/`verdictCounterDelta` in `storage.ts`, the
   per-channel helpers in `stats.ts`, `dashboards.ts` (+ their `.test.ts`), and the
   watch/engagement fields on the types (`SearchHistoryEntry.userRating/watchedSeconds`,
   `LifetimeStats.channels`/`secondsWatched`/`engaged…`). Left in place to avoid a
   cascade — remove carefully, gate with typecheck + tests. **Before** dropping the
   per-channel stats, ship a one-time **export → Watchprint import** migration so
   existing users' accumulated `tldwStats` aren't stranded (chrome.storage is
   per-extension). Plan: [`ANALYTICS_SPLIT.md`](ANALYTICS_SPLIT.md) §5–6 +
   `../watchprint/HANDOFF.md`. (F7 Phase 2 "paid/hosted analytics" is **dropped** —
   Watchprint is local-only/free.)
4. **Stop the prompt requesting the AI verdict (optional).** The panel no longer shows
   the WATCH/SKIM/SKIP verdict, but the summarization prompt still asks for it and
   `src/lib/tldw.ts` still parses it (harmless, just unused). To make TL;DW *purely*
   summaries end-to-end, trim VERDICT/RATING from the built-in profile templates
   (`src/lib/profiles.ts`/`promptBuilder.ts`), the parser, and the worth-watching gate.
5. **Split `youtube.ts`** (~2.7k LOC, now a bit smaller post-decoupling) into panel /
   nav-mount / scrape modules — pure tech-debt refactor; gate with the smoke test.

### C. Optional pre-launch polish
- **Neutralize bundled brand logos** — `src/assets/claude-icon.png` has been
  **deleted**; all four destination marks (Gemini/ChatGPT/Claude/NotebookLM) are
  now **inline SVG** in `src/lib/DestinationIcon.tsx`. The "swap the PNG" task is
  done. They are still real third-party marks (low IP-complaint risk); swapping
  them to neutral labeled glyphs to de-risk a public listing remains optional.
  (User opted to keep for now.)

## Conventions & gotchas

- **Commit after each logical change** with a Conventional-style message + the
  trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
  Push when working on `master` (this session pushed every commit).
- **Dead code from the split:** `engagement.ts`, `recordWatchProgress`/`bumpChannelStat`/
  `verdictCounterDelta` in `storage.ts`, the per-channel helpers in `stats.ts`, and
  `dashboards.ts` are **no longer wired to anything** (the live versions run in
  Watchprint). Don't build on them — they're slated for removal (B3). The on-page panel
  is **summary-only** now (no verdict pill, no engagement cue).
- **Storage writes** must go through `withWriteLock` / `mutateHistory` in
  `src/lib/storage.ts` — the service worker is **not** a single writer (Web Locks
  serialize concurrent RMW). Don't do raw `chrome.storage` read-modify-write.
- **SPA nav staleness:** after any `await` in content scripts, re-check `navEpoch`
  + `videoId` before touching the DOM, or slow async work lands on the wrong video.
- **Build vs package:** `npm run build` bumps the version every run (so the popup
  number changes) and copies to Windows; `npm run package` does neither — it just
  zips `dist/` for upload. Upload the **`dist/` zip**, never `src/`.
- **Don't revisit (killed):** transcript-derived "Key moments"/seek-links (removed),
  and the YouTube Data API (DOM-scrape + intercepted network only). See STATUS
  "Not doing".
- **Mobile:** `m.youtube.com` was intentionally dropped (desktop-only selectors);
  re-adding mobile is a real project, not a quick toggle.
- **Completed planning docs** live in `docs/archive/` with ARCHIVED banners — they
  are historical (stale numbers like "79 tests" are expected there); don't "fix"
  them and don't treat them as live guidance.

## File map (for the next steps)

- `docs/PUBLISH_CHECKLIST.md` — launch runway (start here for publishing).
- `docs/STORE_SUBMISSION.md` — listing copy, 12 permission justifications, data-use.
- `STATUS.md` — live status / roadmap. `PLAN.md` — product thesis + core motion.
- `src/manifest.config.ts` — MV3 manifest (permissions, hosts, content scripts).
- `src/background/index.ts` — service-worker orchestrator; `callGeminiApi` (key
  header), `runSummary`, SponsorBlock fetch.
- `src/content/youtube.ts` — on-page widget (~2.7k LOC); `currentVideoId`.
- `src/content/youtube-intercept.ts` — MAIN-world `fetch` wrapper for transcripts.
- `docs/ANALYTICS_SPLIT.md` — the watch-time/engagement → Watchprint split (rationale,
  feature classification, storage-key ownership, migration). Pairs with
  `../watchprint/PLAN.md`.
- `src/content/sponsorblock.ts` — SponsorBlock auto-skip (still surfaced, first-run
  notice discloses it). (`src/content/watchtime.ts` was **DELETED** in the decoupling —
  the watch-time engine now lives in the Watchprint repo, not here.)
- `src/options/sections/StatsSection.tsx` — the summary-centric Stats page (summaries,
  heatmap+streak, top channels, profile/destination usage, most-used tags).
- `src/popup/App.tsx` — popup; first-run notice (~L318). `src/popup/popup.css`.
- `src/lib/constants.ts` — `DEFAULT_SETTINGS`. `src/lib/storage.ts` — storage + write
  locks (still contains the now-dead `recordWatchProgress`/`bumpChannelStat`).
- ⚠️ `src/lib/dashboards.ts`, `src/lib/engagement.ts`, and the per-channel helpers in
  `stats.ts`/`storage.ts` — **orphaned dead code** post-decoupling (tests retained); the
  live copies run in **Watchprint**. Slated for removal (Next Steps B3).
- `scripts/package-store.mjs` — the Web Store zip builder.
