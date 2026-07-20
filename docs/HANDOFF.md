# TL;DW 1.0 Handoff

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

At this checkpoint, 87 unit tests pass, typecheck passes, and a non-bumping Vite production build passes.

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

1. Upgrade the development baseline and toolchain.
2. Add ESLint and CI.
3. Add Playwright coverage for the built extension and the core BYOK, profile, cache, navigation, error, quota rollover, and service-worker restart scenarios.
4. Set package and lockfile versions to exactly 1.0.0 without running the bumping release helper.
5. Run the full quality gate and validate the store ZIP contents.
6. Run the real-key manual smoke test.
7. Capture store screenshots and the promotional tile without private data.
8. Re-audit the packaged permissions and submit as Unlisted.

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
