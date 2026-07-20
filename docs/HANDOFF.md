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

At this checkpoint, typecheck, ESLint, 87 unit tests, seven built-extension browser tests, the production build, package validation, and the full dependency audit pass.
The 1.0.0 ZIP is at `web-store/tldw-1.0.0.zip` and has SHA-256 `9e359083b53b210a09f22f176dfcfbe97f1f773ab163ed9bf3e28261e45a0176`.
Store graphics are in `store-assets/`.

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

1. Run the real-key manual smoke test.
2. Capture more screenshots if the preferred five-image set is desired.
3. Re-check the final store dashboard declarations against the packaged manifest.
4. Upload the validated ZIP and assets through the publisher account.
5. Submit with Unlisted visibility.
6. Monitor the soft-launch cohort through user reports.

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
