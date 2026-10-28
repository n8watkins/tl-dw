# TL;DW 1.0 Handoff

## Current state and open work (2026-10-27): start here

### What this is

TL;DW (Too Long; Didn't Watch) is a Manifest V3 Chrome extension for YouTube.
It sends the current video to Gemini, ChatGPT, Claude or NotebookLM in one keystroke, and with a saved Gemini key it summarizes the video on the page through the Gemini API (bring your own key).
Repo: `n8watkins/tl-dw`, default branch `master`.
It is not live anywhere yet: the 1.0.0 Unlisted Chrome Web Store submission is prepared but has not been uploaded (no tags or GitHub Releases exist).

### Status as of today

- Version 1.0.0; the validated store ZIP and assets are described under "Completed changes" below and in [PUBLISH_CHECKLIST.md](PUBLISH_CHECKLIST.md).
- CI is green on master: the Quality gate (typecheck, lint, unit tests, e2e, build, package validation, `npm audit`) and the Commit messages check both pass on `dec995f`.
- The gate had failed on master from 2026-07-20 until PR #3 (`20b1938`, 2026-10-27) fixed it; the diagnosis is in [CI_QUALITY_GATE_FAILURE.md](CI_QUALITY_GATE_FAILURE.md).
- release-kit 2.0.0 was adopted as a dev dependency in PR #4 (`dec995f`); see [../RELEASING.md](../RELEASING.md).
- Nothing is merged but unreleased in a user-facing sense, because nothing has shipped yet.

### Open problems

1. **YouTube Shorts comments stop updating when scrolling between Shorts (HIGH, user-facing).**
   Seen with both TL;DW and TubeVault installed; it is not yet known which extension causes it, or whether it needs both.
   Reproduce: load both unpacked extensions in Chrome, open any `https://www.youtube.com/shorts/...` page, open the comments panel, scroll to the next Short, and check whether the comments still show the previous Short.
   Likely places in TL;DW (read, not yet confirmed):
   - `src/content/youtube.ts` `onNavigate()` runs on `yt-navigate-finish` and every 500 ms, treats `/shorts/` as a video page (`currentVideoId()` in `src/lib/constants.ts`), and on each new Short calls `removeSummaryPanel()`, `ensureWatchButton()` and `maybeStartDirectApiRun()`.
   - `openTranscriptPanel()` / `closeTranscriptPanel()` in the same file click YouTube's description and engagement-panel controls; if any path reaches them on a Short it could disturb the Shorts engagement panel that hosts comments.
   - `src/content/sponsorblock.ts` `handleNav()` also runs on every navigation and a 1 s poll.
   - `src/content/youtube-intercept.ts` wraps `window.fetch` in the page world, but only reads `get_transcript` and `timedtext` responses, so it is an unlikely cause.
   In TubeVault the main suspect is its Shorts button, which inserts a React root into YouTube's recycled `reel-action-bar-view-model` (see TubeVault's `docs/HANDOFF.md`).
   Plan: isolate by loading one extension at a time (TL;DW only, TubeVault only, both), then fix the culprit and add a Playwright regression test that scrolls between Shorts and asserts the comments panel follows the active Short.
2. **Local `npm ci` fails on npm 12.**
   npm 12 defaults `allow-git` to `none`, and release-kit is a `github:` dev dependency, so `npm ci` stops with `EALLOWGIT` and leaves `node_modules` empty.
   Use `npm ci --allow-git=all` locally until the dependency source changes; CI's `npm ci` still succeeds (its runner uses an older npm).
3. **No local commit-msg hook.**
   `RELEASING.md` says a `commit-msg` hook checks commit messages, but the repo has no `.githooks/` and no `prepare` script.
   When release-kit was applied, the local `core.hooksPath` still pointed at a deleted folder (`~/personal/tools/extensions/tldw/.git/hooks`), so release-kit treated it as another hook manager and skipped installing its hook.
   That stale local setting was removed on 2026-10-27; re-run release-kit's apply step (or add `.githooks/commit-msg` and the `prepare` script it writes) to get the hook.
   The Commit messages CI check still enforces the format on every push.

### Blocked on the owner

- Chrome Web Store: uploading the ZIP and assets and submitting with Unlisted visibility needs the publisher account (steps 2 to 4 under "Required remaining work" below).
- Gemini model: the owner decided on 2026-10-27 to move Gemini text calls to Gemini 3.5 Flash-Lite and will provide new API keys.
  The model code confirmed on ai.google.dev on 2026-10-27 is `gemini-3.5-flash-lite`.
  The current model is `GEMINI_MODEL_ID = "gemini-3.1-flash-lite"` in `src/lib/constants.ts`, and the docs below, `STATUS.md`, `PRIVACY.md` and the store copy name 3.1 Flash-Lite, so the switch touches code, tests and disclosures and needs a fresh real-key smoke test ([SMOKE_TEST.md](SMOKE_TEST.md)).
  This supersedes the "Keep Gemini 3.1 Flash-Lite fixed" constraint below.

### Next steps, in order

1. Isolate and fix the Shorts comments bug (open problem 1), with a regression test.
2. Switch the Direct API model to `gemini-3.5-flash-lite` and update the disclosures, then repeat the real-key smoke test with the owner's new key.
3. Restore the local commit-msg hook via release-kit (open problem 3).
4. Rebuild and revalidate the store ZIP with `npx vite build`, `npm run package` and `npm run validate:package` (never `npm run build`, which bumps the version), then hand the upload to the owner.

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
- Keep Gemini 3.1 Flash-Lite fixed with no model selector.
- Keep destination-site selector verification in the manual smoke test.
- Preserve profiles, tags, settings, history, and lifetime summary stats.
- Discard legacy video-only cache entries.

## Release documents

- [PUBLISH_CHECKLIST.md](PUBLISH_CHECKLIST.md)
- [STORE_SUBMISSION.md](STORE_SUBMISSION.md)
- [SMOKE_TEST.md](SMOKE_TEST.md)
- [../PRIVACY.md](../PRIVACY.md)
