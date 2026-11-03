# TL;DW Handoff

## Current state and open work (2026-11-02): start here

### What this is

TL;DW (Too Long; Didn't Watch) is a Manifest V3 Chrome extension for YouTube.
The TL;DW button under a video puts an AI summary on the page: with no key it opens Gemini in a background tab and reads the answer back (Gemini then works from the transcript, or for a video without one, from public info about it: signed-out Gemini does not watch YouTube videos); with the user's own free Gemini API key (Direct API) the summary comes straight from the API with no tab.
It can also send a video to ChatGPT, Claude or NotebookLM.
Repo: `n8watkins/tl-dw`, default branch `master`.
It is not live in the Chrome Web Store yet: the Unlisted submission still needs the owner's publisher account.

### Status as of today

- Version 1.1.3 reads transcripts YouTube's own button can't load (open problem 2), and caches only a parsed summary the page was still waiting for: an unparsed answer or one that came after the page gave up is shown but never cached.
- Version 1.1.2 fixes signed-in sends that waited out the three-minute deadline: TL;DW looked for the stop button anywhere on the page, and a sidebar chat titled with "Stop" or "Cancel" matched; buttons are now found only inside the composer, by whole label (LESSONS_LEARNED.md lesson 19).
- Version 1.1.1 fixes a v1.1.0 regression: every no-key send to the background Gemini tab timed out (0 of 9 in a live test), because a hidden Gemini tab keeps its answer's paragraphs `display: none` and TL;DW read only rendered text.
  The reader now falls back to the DOM tree and waits until the answer stops changing; see LESSONS_LEARNED.md lesson 18.
  It also makes no-key link sends honest: a long video goes to the Gemini tab as the start and end of its transcript (labeled "Summarized from part of the transcript (video is long)"), a video with no transcript goes as its link labeled "No transcript, so Gemini summarized from public info about this video", link prompts always carry the URL, and "Watched by Gemini" appears only on the API video path.
  Signed in to Gemini (owner's live test, 2026-11-02), the web app's YouTube tool reads a linked video's captions, even for a 2.5-hour video, but never watches frames; signed out it only web-searches.
  So for a long video, or a captioned one whose transcript TL;DW couldn't read, the worker also prepares a link prompt that asks Gemini to read the transcript (`signedInPrompt` in the pending prompt), and the Gemini injector sends it only when the page shows Google's account button and no sign-in link (`geminiSignedIn()` in `src/content/inject.ts`); that summary is labeled "Gemini read the video's transcript through YouTube". When unsure it treats the user as signed out.
  ChatGPT and Claude's long-transcript choice now sends the start and end ("Send part of the transcript"), and `parseTldwBlock` splits a `DETAILS:` label run onto the SUMMARY line.
  Check background-tab behavior with `scripts/live-background-tab.mjs` (plain Chromium under xvfb), never with Playwright alone.
- Version 1.1.0 (PRs #15 to #18) implements the owner's 2026-11-02 decisions and the UX audit:
  - first install opens `options#welcome` (two modes, free-key steps, "Skip, use without a key"); a verified key turns Direct API on;
  - sends are planned up front (`src/lib/sendPlan.ts`): the API gets the whole transcript or, with none, watches the YouTube link as video input (`fileData.fileUri`, `MEDIA_RESOLUTION_LOW`); without a key, ChatGPT or Claude get an on-page choice for a transcript too long for them (1.1.1 changed the Gemini tab's handling, see above);
  - Direct API defaults to `gemini-3.5-flash-lite` and retries once on `gemini-3.1-flash-lite` after a 429 (a per-day quota violation sticks to the fallback for the Pacific quota day), with a model picker;
  - the base install asks only for YouTube, Gemini and the Gemini API; ChatGPT, Claude, NotebookLM and SponsorBlock are `optional_host_permissions`, and the injector for those sites is registered at runtime with `chrome.scripting`; the `tabs` permission is gone;
  - SponsorBlock is opt-in; PRIVACY.md is dated 2026-11-02.
- No Gemini key was available on 2026-11-02 (`pass-env check` found no password store), so the 3.5 Flash-Lite model, the fallback and YouTube video input were verified only against mocked API responses, plus Google's model list (aistudio.google.com/docs/models).
  Run `pass-env run -- npm run smoke:gemini` with a real key to check both models and video input live.

### Open problems

1. **YouTube Shorts comments stop updating when scrolling between Shorts (HIGH, user-facing, most likely TubeVault).**
   Seen with both TL;DW and TubeVault installed.
   TL;DW no longer runs on Shorts at all (owner decision, 2026-11-02): its content scripts treat only `/watch?v=` as a video page (`currentVideoId()` in `src/content/youtube.ts`, `videoIdFromUrl()` in `src/content/sponsorblock.ts`, `currentUrlVideoId()` in `src/content/youtube-intercept.ts`), so on a Short they read nothing, click nothing and mount nothing.
   On 2026-11-02, with TL;DW loaded alone in Playwright Chromium against live YouTube, the comments panel followed each Short across three scrolls, both before and after that change.
   In TubeVault the main suspect is its Shorts button, which inserts a React root into YouTube's recycled `reel-action-bar-view-model` (see TubeVault's `docs/HANDOFF.md`).
   Next: reproduce with TubeVault alone, fix it there, and add a Playwright regression test that scrolls between Shorts and asserts the comments panel follows the active Short.
2. **Some captioned videos gave TL;DW no transcript (fixed in 1.1.3; watch for regressions).**
   Cause: for some videos YouTube's own "Show transcript" button calls the legacy `get_transcript`, which YouTube answers with 400 FAILED_PRECONDITION, so its own panel stays empty.
   It happens for chaptered videos (3Blue1Brown's `aircAruvnKk`, `IHZwWFHWa-w`) signed out, and varies by account and experiment: signed in, the 2h24m Lex Fridman #367 (`L_Guz73e6fw`) failed in 4 of 5 runs, while signed out it went through the modern panel.
   The modern transcript panel (`get_panel`, `panelId: "PAmodern_transcript_view"`, `params` = base64 of the protobuf `{149: {1: videoId, 3: 2}}`) still serves every one of those videos (checked 2026-11-02: 3Blue1Brown 18,430 and 20,163 characters, Lex 129,690).
   Since 1.1.3 TL;DW asks for that panel itself first, from the page's MAIN world without the user's cookies (`requestTranscriptPanel()` in `src/content/youtube-intercept.ts` and `src/content/youtube.ts`), and only opens YouTube's panel when that fails.
   The caption track URLs carry `exp=xpe` and return empty bodies without a PO token, so they are no fallback.
   If YouTube changes the `params` format, the direct request returns nothing and TL;DW falls back to the button; `transcriptPanelParams()` has a unit test pinned to captured values.
   Next: the signed-in tester confirms the Lex video reads its transcript signed in.
3. **Local `npm ci` fails on npm 12.**
   npm 12 defaults `allow-git` to `none`, and release-kit is a `github:` dev dependency, so `npm ci` stops with `EALLOWGIT` and leaves `node_modules` empty.
   Use `npm ci --allow-git=all` locally until the dependency source changes; CI's `npm ci` still succeeds (its runner uses an older npm).
4. **No local commit-msg hook.**
   `RELEASING.md` says a `commit-msg` hook checks commit messages, but the repo has no `.githooks/` and no `prepare` script.
   When release-kit was applied, the local `core.hooksPath` still pointed at a deleted folder (`~/personal/tools/extensions/tldw/.git/hooks`), so release-kit treated it as another hook manager and skipped installing its hook.
   That stale local setting was removed on 2026-10-27; re-run release-kit's apply step (or add `.githooks/commit-msg` and the `prepare` script it writes) to get the hook.
   The Commit messages CI check still enforces the format on every push.

5. **Dev-only `minimatch` advisory (low).**
   Since 2026-11-02, `npm audit` reports GHSA-g3hv-75wg-m249 (moderate, `minimatch` below 11.0.1) through eslint, `@eslint/*`, `eslint-plugin-react` and `typescript-eslint`.
   Nothing compatible fixes it yet: those packages call minimatch 3's function export, which minimatch 11 dropped, so an override would break lint.
   The Quality gate now fails on any advisory in production dependencies (`npm audit --omit=dev`) and on high or critical ones across the whole tree (`npm audit --audit-level=high`).
   Go back to a plain `npm audit` once eslint ships on minimatch 11.

6. **Most videos gave no transcript in signed-out automation (fixed in 1.1.3, see problem 2).**
   The same `get_transcript` refusal; the direct transcript-panel request reads them now.

### Blocked on the owner

The owner's steps (Gemini key and live smoke test, the signed-in Chrome check, the Chrome Web Store submission) are tracked in [../OWNER-TODO.md](../OWNER-TODO.md); keep that file current instead of listing them here.

### Next steps, in order

1. Confirm the Shorts comments bug is TubeVault's (open problem 1) and fix it there, with a regression test.
2. Run the real-key smoke test of v1.1.0 (3.5 Flash-Lite, fallback, video input) once the owner's key is in pass-env.
3. Restore the local commit-msg hook via release-kit (open problem 4).
4. Rebuild and revalidate the store ZIP with `npx vite build`, `npm run package` and `npm run validate:package` (never `npm run build`, which bumps the version), then hand the upload to the owner.
5. Done in v1.1.0: CI runs on Node 24 (`.nvmrc`).

## Objective

Finish and verify the Unlisted Chrome Web Store launch for TL;DW 1.0.0.
The release centers on bring-your-own-key Gemini 3.1 Flash-Lite summaries.

## Completed changes

- `9e0a5fe` resolves the effective summary profile before any prompt is built.
- `9a3965c` replaces video-only caching with background-owned prompt-aware variants.
- `7c9e482` adds saved-key metadata verification and validation state.
- `2130d25` adds Pacific quota-day attempt, success, failure, and all-time usage accounting.
- `a853f4c` adds structured, actionable Gemini errors.
- `570b4f6` aligns privacy and Chrome Web Store disclosures.

At this checkpoint, typecheck, ESLint, 87 unit tests, nine built-extension browser tests, the production build, package validation, and the full dependency audit pass.
The 1.0.0 ZIP is at `web-store/tldw-1.0.0.zip` and has SHA-256 `4f23656d8b72ef2803d0faa168c138492df3e2bac9654d2811b9047912119fc0`.
Store graphics are in `store-assets/`.

The real-key smoke test is complete using the saved local Gemini key. Gemini 3.1 Flash-Lite key verification and a real `generateContent` request passed. The browser flow also confirmed successful usage accounting, profile/question cache misses, passive exact-cache hits, and repeated popup cache hits. No key or account identifier was written to the repository.

## Architecture notes

- `src/background/index.ts` orchestrates profile resolution, transcript requests, cache access, Gemini calls, destination tabs, history, and runtime messages.
- `src/lib/summaryProfile.ts` owns entry-point-specific profile selection.
- `src/lib/summaryCache.ts` owns cache normalization, pruning, exact and passive lookup, upsert, and SHA-256 fingerprints.
- `src/lib/geminiKeyValidation.ts` owns metadata verification and safe validation categories.
- `src/lib/geminiUsage.ts` owns Pacific quota days and usage migration transitions.
- `src/lib/geminiApi.ts` owns the fixed-model request and safe failure model.
- `src/lib/storage.ts` owns persistent storage access and migrations.
- `src/content/youtube.ts` owns transcript extraction and the YouTube UI.

## Required remaining work

1. Capture more screenshots if the preferred five-image set is desired.
2. Re-check the final store dashboard declarations against the packaged manifest.
3. Upload the validated ZIP and assets through the publisher account.
4. Submit with Unlisted visibility.
5. Monitor the soft-launch cohort through user reports.

## Constraints

- Do not commit a real Gemini key or any account identifier.
- Do not edit `CHANGELOG.md` or archived documents.
- Do not use `npm run build` for the final fixed-version release because it increments the patch version.
- Use `npx vite build` for a non-bumping production build.
- Keep React 18 for 1.0.
- Keep destination-site selector verification in the manual smoke test.
- Preserve profiles, tags, settings, history, and lifetime summary stats.
- Discard legacy video-only cache entries.

## Release documents

- [PUBLISH_CHECKLIST.md](PUBLISH_CHECKLIST.md)
- [STORE_SUBMISSION.md](STORE_SUBMISSION.md)
- [SMOKE_TEST.md](SMOKE_TEST.md)
- [../PRIVACY.md](../PRIVACY.md)
