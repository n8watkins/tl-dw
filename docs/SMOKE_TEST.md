# TL;DW 1.0 Manual Smoke Test

Run this checklist against the exact packaged 1.0.0 build.
Use a dedicated Gemini key and project with no unrelated production access.

## Build and setup

- [ ] Confirm the unpacked and packaged manifests report version 1.0.0.
- [ ] Confirm the package contains no source maps, secrets, development assets, or stale files.
- [ ] Load the production extension in Chrome.
- [ ] Open the popup once and confirm the SponsorBlock first-run notice appears and can be dismissed.
- [ ] Open every options section and confirm there are no visible layout defects or console errors.

## Key onboarding

- [ ] Create or select a dedicated Google AI Studio project for TL;DW.
- [ ] Save and name a new key.
- [ ] Confirm the UI shows a transient Verifying state.
- [ ] Confirm a valid key persists as valid after reopening the options page.
- [ ] Confirm verification does not increment the Gemini summary-request meter.
- [ ] Save an invalid or restricted key and confirm it remains saved with an actionable error.
- [ ] Retry verification without pasting the key again.
- [ ] Delete the key and confirm validation state and Direct API enablement are cleared.

## Profiles and prompts

- [ ] Set different global-default and Direct API auto-run profiles.
- [ ] Trigger an automatic summary and confirm the Direct API profile shaped the response.
- [ ] Trigger the manual on-page button and confirm the global default profile shaped the response.
- [ ] Choose a different profile in the popup and summarize inline.
- [ ] Confirm the popup-selected profile shaped the response and was not overwritten.
- [ ] Confirm the call log identifies the same profile that was sent.

## Cache variants

- [ ] Repeat an identical Direct API request and confirm it returns from cache without another Gemini attempt.
- [ ] Change the profile and confirm a fresh request occurs.
- [ ] Ask a specific popup question and confirm a fresh request occurs.
- [ ] Change a tag and confirm a fresh request occurs.
- [ ] Edit a profile prompt and confirm a fresh request occurs.
- [ ] Use Regenerate and confirm it bypasses the matching cache entry and replaces it.
- [ ] Clear cache for one video and confirm every variant for that video is removed.
- [ ] Clear all cached summaries and confirm the variant count reaches zero.
- [ ] Revisit a video passively and confirm the newest cached variant appears once with its profile in the source label.
- [ ] Confirm the cache-hit statistic increments once for that delivery.

## Usage and quota day

- [ ] Confirm the meter reads "TL;DW requests this Gemini quota day."
- [ ] Confirm it identifies the Gemini 3.1 Flash-Lite 500 RPD allowance as of July 2026.
- [ ] Confirm an attempted request increments before its result arrives.
- [ ] Confirm successful and failed requests update their separate counters.
- [ ] Confirm a failed request still remains in attempts.
- [ ] Confirm all-time attempts survive clearing usage.
- [ ] Confirm quota-day rollover follows Pacific midnight.
- [ ] Confirm AI Studio usage, key, billing, and budget links open correctly.

## Errors and loading state

- [ ] Exercise an invalid key and confirm the page panel, popup status, Direct API history, and key status use actionable consistent guidance.
- [ ] Exercise a practical or mocked 429 response and confirm the quota guidance and AI Studio usage link.
- [ ] Exercise a timeout and confirm the loading state ends immediately after the TL;DW timeout.
- [ ] Exercise malformed model output and confirm no loading state remains stuck.
- [ ] Confirm no error reveals a key, request header, transcript, or full prompt.
- [ ] Use Try again and confirm a new attempt starts.

## YouTube navigation

- [ ] Start a summary on video A and navigate to video B before completion.
- [ ] Confirm video A's summary never renders or caches under video B.
- [ ] Navigate back to video A and confirm its own summary is available.
- [ ] Repeat with open-in-a-tab mode.
- [ ] Confirm a service-worker restart preserves settings, key validation, usage, profiles, and cache variants.

## Destination regression checks

External destination DOM structures are volatile, so these remain manual.

- [ ] Gemini open-in-a-tab auto-fill and response scrape work.
- [ ] ChatGPT auto-fill and response scrape work.
- [ ] Claude auto-fill and response scrape work.
- [ ] NotebookLM YouTube-source insertion works.
- [ ] Clipboard fallback provides a usable prompt when a destination selector fails.
- [ ] Right-click profile selection and `Alt+Shift+G` still work.

## UI quality

- [ ] Inspect popup, options, on-page button, summary panel, error panel, tags, channels, stats, and SponsorBlock controls in light and dark themes.
- [ ] Fix clipped text, inconsistent spacing, broken icons, poor contrast, stale loading states, and visible layout shifts before release.
- [ ] Confirm Shorts behavior remains intentional and clear.
- [ ] Confirm no watch-time, engagement, rating, or WATCH/SKIM/SKIP UI appears.

## Store assets

- [ ] Capture at least one 1280 by 800 screenshot from this verified build.
- [ ] Prefer all five shots listed in [STORE_SUBMISSION.md](STORE_SUBMISSION.md).
- [ ] Capture or generate the 440 by 280 promotional tile.
- [ ] Confirm all images exclude API keys, account identifiers, private history, and unrelated browser UI.
