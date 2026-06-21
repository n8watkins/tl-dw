# Handoff — TL;DW

Zero-context handoff. Read this + [`STATUS.md`](../STATUS.md) +
[`docs/PUBLISH_CHECKLIST.md`](PUBLISH_CHECKLIST.md) first; they answer most
questions — don't re-ask the user what they already decide here.

_Last updated: 2026-06-20._

## Project summary

**TL;DW** ("Too Long; Didn't Watch") is a **Manifest V3 Chrome extension** that
summarizes the YouTube video you're watching so you can decide if it's worth your
time. Two modes: **Direct API** (your own free Gemini key → summary rendered on the
YouTube page, no tab opens) and **open-in-a-tab** (Gemini/ChatGPT/Claude/NotebookLM,
prompt auto-filled + submitted, answer read back onto the page). Plus SponsorBlock
auto-skip, watch-time engagement auto-rating, per-channel stats, and week/month/year
dashboards. **No backend, no accounts, no analytics** — everything is local.

- **Stack:** TypeScript + Vite + `@crxjs/vite-plugin`; React for popup/options,
  vanilla TS for content scripts. Vitest for unit tests.
- **Repo:** `github.com/n8watkins/tl-dw` (public), branch `master`.
- **Local path:** `~/projects/extensions/tldw` (moved from `~/n8builds/...` this
  session).
- **Run:** `npm run dev` (live dev). `npm run build` bumps the patch version and
  rsyncs `dist/` to `/mnt/c/Users/natha/Projects/Tools/tldw` (the Windows
  load-unpacked folder). `npm run package` builds the clean Web Store zip
  (`web-store/tldw-<version>.zip`, no version bump, no Windows copy).
- **Gate (run before every commit):** `npm run typecheck` && `npm test` (**101
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

**Verified working:** `npm run typecheck` clean, **101/101** Vitest tests pass,
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
- **Decision pending (user):** bump version `0.1.156` → `1.0.0` for the public
  listing (cosmetic).

### B. Feature development (post-launch roadmap)
From [`STATUS.md`](../STATUS.md) and the audits, in rough priority:
1. **Avatar URL refresh/de-dup** — YouTube avatar CDN URLs in storage expire and
   fire broken image requests before the `onError` color-hash fallback. Needs a
   refresh/de-dup strategy. Files: `src/options/sections/ChannelsSection.tsx`,
   `src/options/sections/StatsSection.tsx`, storage avatar fields. *Accept:* stale
   URLs don't cause visible broken-image flashes; avatars refresh.
2. **Popup channel context card** — the popup has no per-channel awareness while
   browsing. Add a "you've watched N from this channel, avg AI X.X" line.
   Files: `src/popup/App.tsx`, `src/lib/` channel stats helpers.
3. **F7 Phase 2 — paid/hosted analytics** (the one open *product* bet, undecided).
   Reasoning + the "don't charge for local data" stance are in
   [`docs/archive/F7_PHASE1_PLAN.md`](archive/F7_PHASE1_PLAN.md) §0. Needs a
   product decision before any build.
4. **Shorts on-page widget** — the on-page panel doesn't render on `/shorts/` URLs
   because `currentVideoId()` reads only `?v=` (`src/content/youtube.ts` ~L22).
   Shorts currently work only via the popup→Gemini path. If on-page Shorts support
   is wanted, parse `/shorts/<id>`. (Listing copy already scoped honestly.)
5. **Split `youtube.ts`** (~2.7k LOC) into panel / nav-mount / scrape modules —
   pure tech-debt refactor; keep behavior identical, gate with the smoke test.

### C. Optional pre-launch polish
- **Neutralize bundled brand logos** — `src/assets/claude-icon.png` and the OpenAI/
  Gemini/NotebookLM marks in `src/lib/DestinationIcon.tsx` are real third-party
  logos. Low IP-complaint risk; swap to neutral labeled glyphs to de-risk a public
  listing. (User opted to keep for now.)

## Conventions & gotchas

- **Commit after each logical change** with a Conventional-style message + the
  trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
  Push when working on `master` (this session pushed every commit).
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
- `src/content/youtube.ts` — on-page widget (~2.7k LOC); `currentVideoId` (Shorts gap).
- `src/content/youtube-intercept.ts` — MAIN-world `fetch` wrapper for transcripts.
- `src/content/sponsorblock.ts`, `src/content/watchtime.ts` — the auto-on features
  the first-run notice discloses.
- `src/popup/App.tsx` — popup; first-run notice (~L318). `src/popup/popup.css`.
- `src/lib/constants.ts` — `DEFAULT_SETTINGS` (`firstRunNoticeSeen`, `skipSponsors`,
  `trackEngagement`). `src/lib/storage.ts` — storage + write locks.
- `src/lib/dashboards.ts` (+ `.test.ts`) — F7 windowed stats.
- `scripts/package-store.mjs` — the Web Store zip builder.
