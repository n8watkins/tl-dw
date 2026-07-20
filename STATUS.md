# TL;DW Extension Status

**Version:** 1.0.0
**Last updated:** July 20, 2026

TL;DW 1.0 is being prepared as an Unlisted Chrome Web Store soft launch centered on bring-your-own-key Gemini access.

## Implemented

- Direct API summaries use the fixed Gemini 3.1 Flash-Lite model.
- Automatic Direct API runs use the configured Direct API profile.
- Popup inline runs preserve the popup-selected profile.
- Manual on-page runs use the global default profile.
- Prompt construction, history, call metadata, and cache context use the same resolved profile.
- Summary caching is prompt-aware and owned by the background worker.
- Cache variants include the video, SHA-256 prompt fingerprint, parsed summary, profile, model or destination, and timestamp.
- Passive navigation shows the newest cached variant and identifies its profile.
- Exact repeated requests use the matching cache variant.
- Regeneration bypasses and replaces the matching request context.
- Legacy video-only cache data is discarded.
- Gemini keys are saved before metadata verification.
- Key validation persists `unverified`, `valid`, or `invalid` state with a timestamp and safe failure category.
- The local Gemini usage schema counts every inference attempt before `generateContent`.
- Quota-day rollover uses `America/Los_Angeles`, including daylight-saving changes.
- Usage tracks daily attempts, successes, failures, all-time attempts, and last success.
- Gemini failures use safe categories for rejected requests, authorization, model availability, quota, Google service failures, timeout, network, and malformed output.
- Failed requests end the on-page loading state and provide retry and relevant AI Studio guidance.
- Policy documents disclose BYOK handling, parsed summary caching, call-log metadata, and the `x-goog-api-key` header.

## Product scope

TL;DW produces SUMMARY and DETAILS shaped by profiles, tags, and optional questions.
It does not track watch time or engagement and does not produce a built-in rating or WATCH/SKIM/SKIP verdict.
Summary-centric history and activity remain local.
SponsorBlock remains optional and on by default after the first-run disclosure.

## Verification status

- A clean `npm ci` passes on Node 20.19 or newer.
- Typecheck and ESLint pass.
- All 87 unit tests pass.
- All seven built-extension Playwright scenarios pass.
- The non-bumping Vite production build passes.
- Full `npm audit` reports zero vulnerabilities.
- Store package validation passes for `web-store/tldw-1.0.0.zip`.
- The packaged root manifest reports version 1.0.0.
- The required 1280 by 800 screenshot and 440 by 280 promotional tile exist in `store-assets/`.
- Real-key verification remains manual because no secret key is committed to the repository.
- Chrome Web Store upload and Unlisted submission remain manual because they require the publisher account.

## Known follow-up

YouTube avatar CDN URLs can expire.
The UI falls back to a generated initial, but a future refresh strategy could avoid failed image requests.

The large YouTube content script remains a refactoring candidate after the 1.0 launch.

## Release references

- [docs/PUBLISH_CHECKLIST.md](docs/PUBLISH_CHECKLIST.md)
- [docs/STORE_SUBMISSION.md](docs/STORE_SUBMISSION.md)
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)
- [PRIVACY.md](PRIVACY.md)
