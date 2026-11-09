# TL;DW Extension Status

**Version:** 1.4.0
**Last updated:** November 9, 2026

TL;DW is being prepared as an Unlisted Chrome Web Store soft launch: Gemini only, with your own free key or with no key at all.

## Implemented

- TL;DW is Gemini-only since 1.4 (docs/DECISIONS.md): the Gemini API with your own key, or the Gemini tab without one.
- With a key, summaries default to Gemini 3.5 Flash-Lite and retry once on Gemini 3.1 Flash-Lite after a 429; a model picker offers larger models.
- Transcript first in both modes (docs/DECISIONS.md): the transcript goes as one "[m:ss] text" line per caption.
  A long one goes whole: in up to 12 messages to the Gemini tab, or as notes per part with the API; only beyond about six hours in the tab is it sent as its start and end, labeled so.
- Without a transcript: with a key the API watches the video (in two-hour stretches when longer than 2.5 hours); without one the Gemini tab gets the link only when signed in, and signed out the page asks the user to sign in.
- The no-key Gemini tab is read back even while it stays in the background.
- Four built-in profiles with their own layouts: Quick, Research, Learning, Tutorial. Moment Finder is gone; custom profiles pick a layout.
- A time is shown only when the model's quoted words are in the captions within 15 seconds of it; a link-based summary never shows times.
- The panel: header with the style and mode, a ⋯ menu (Regenerate, Copy, Open in Gemini, Style, the channel's style, Auto-summarize, Settings) and a quiet source line.
- The style for a run: the one picked for it, then the channel's default style, then the default profile. Tags are labels on the Channels page and no longer change prompts.
- A first install opens a welcome page with the free-key steps; SponsorBlock is the one optional host permission and is off by default.
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

TL;DW produces a takeaway and the points its profile's layout asks for, shaped by the profile and an optional question.
It does not track watch time or engagement and does not produce a built-in rating or WATCH/SKIM/SKIP verdict.
Summary-centric history and activity remain local.
SponsorBlock skipping remains optional and off by default; turning it on asks for the `sponsor.ajay.app` permission.

## Verification status

- Typecheck and ESLint pass.
- All 177 unit tests and all 73 built-extension Playwright scenarios pass, including axe WCAG AA checks of the panel (light and dark), the popup and the options pages.
- Real YouTube, signed-out Gemini, no key: all four styles on 3Blue1Brown, a 1-hour talk sent whole in 3 parts, and the sign-in message for a video without captions (9 Nov 2026).
- `npm audit --omit=dev` reports zero vulnerabilities; seven moderate dev-only findings come from minimatch under typescript-eslint and wait for its next release.
- Store package validation passes for `web-store/tldw-1.4.0.zip` (manifest 1.4.0, permissions storage, contextMenus and clipboardWrite).
- Real-key verification remains an environment-specific manual check because no secret key is committed to the repository.
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
