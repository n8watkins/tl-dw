# Publish TL;DW 1.0.0 to the Chrome Web Store

This checklist covers the unlisted bring-your-own-key soft launch.
Detailed listing copy and permission disclosures live in [STORE_SUBMISSION.md](STORE_SUBMISSION.md).

## Release blockers

- [x] All unit and extension browser tests pass.
- [x] Typecheck and lint pass.
- [x] The production Vite build passes.
- [x] Store package validation passes.
- [x] A full dependency audit passes.
- [x] `package.json`, `package-lock.json`, and packaged `manifest.json` all report exactly `1.0.0`.
- [x] The ZIP has `manifest.json` at its root.
- [x] The ZIP contains no source maps, secrets, development assets, or stale build artifacts.
- [x] At least one 1280 by 800 screenshot exists.
- [x] A 440 by 280 promotional tile exists.
- [ ] A Chrome Web Store developer account with 2-Step Verification and a verified contact email is ready.

## Real-key verification

Use a dedicated Google AI Studio project and key that contain no unrelated production access.

- [ ] Saving the key immediately runs metadata verification for Gemini 3.1 Flash-Lite.
- [ ] A valid key is shown as valid.
- [ ] An invalid or restricted key is saved but shown with an actionable failure.
- [ ] A Direct API summary succeeds and uses the selected effective profile.
- [ ] Repeating the exact request produces a cache hit without another Gemini call.
- [ ] Changing the profile produces a cache miss.
- [ ] Asking a specific question produces a cache miss.
- [ ] A failed key and a practical quota-limit simulation leave no loading state stuck.
- [ ] The popup first-run notice works.
- [ ] YouTube SPA navigation never displays a summary on the wrong video.
- [ ] Open-in-a-tab fallback still works.

## Store assets

- [ ] Capture the on-page Direct API summary at 1280 by 800.
- [ ] Prefer the complete five-image set described in [STORE_SUBMISSION.md](STORE_SUBMISSION.md).
- [x] Create the 440 by 280 promotional tile.
- [x] Confirm that images contain no API key, account identifier, private call history, or unrelated browser UI.

## Privacy and permissions

- [x] Re-check [PRIVACY.md](../PRIVACY.md) against the packaged behavior.
- [x] Confirm that the key is sent in the `x-goog-api-key` header and never in the URL.
- [x] Confirm that parsed summaries are disclosed as locally cached data.
- [x] Confirm that call-log metadata disclosure includes video URL, title, timestamp, selected profile, and outcome.
- [x] Confirm that every packaged permission and host permission has a matching justification.
- [x] Confirm that TL;DW is described as BYOK with no shared developer key and no developer backend.

## Submit

- [ ] Upload the verified 1.0.0 ZIP.
- [ ] Paste the reviewed copy and justifications from [STORE_SUBMISSION.md](STORE_SUBMISSION.md).
- [ ] Set distribution visibility to **Unlisted**.
- [ ] Submit for review.

## After approval

TL;DW has no telemetry.
Monitor key-verification, summary-completion, cache, and destination-injection problems through user reports.
Promote to Public only after the unlisted cohort confirms the core BYOK flow and no policy corrections are needed.
