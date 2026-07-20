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

- Unit tests, typecheck, and a non-bumping Vite production build pass at this checkpoint.
- Real-key verification remains manual because no secret key is committed to the repository.
- Built-extension Playwright coverage, lint, CI, packaging validation, final dependency audit, and store graphics remain release work.
- The final package must report version 1.0.0 and contain no source maps, secrets, development assets, or stale artifacts.

## Known follow-up

YouTube avatar CDN URLs can expire.
The UI falls back to a generated initial, but a future refresh strategy could avoid failed image requests.

The large YouTube content script remains a refactoring candidate after the 1.0 launch.

## Release references

- [docs/PUBLISH_CHECKLIST.md](docs/PUBLISH_CHECKLIST.md)
- [docs/STORE_SUBMISSION.md](docs/STORE_SUBMISSION.md)
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)
- [PRIVACY.md](PRIVACY.md)
