# TL;DW - Privacy Policy

_Last updated: July 20, 2026 (extension v1.0.0)_

TL;DW is a bring-your-own-key Chrome extension that summarizes YouTube videos.
TL;DW has no shared developer API key, developer backend, account system, analytics, tracking, or telemetry.
Persistent extension data stays in Chrome local storage on the user's device.

## Data stored on your device

TL;DW stores the following data in `chrome.storage.local`:

- Settings, prompt profiles, and tags.
- Summary history containing a transcript-free prompt and video metadata such as URL, title, channel, and timestamp.
- Parsed summaries in a seven-day, prompt-aware summary cache.
- Lifetime summary, cache-hit, and SponsorBlock counters.
- Per-day summary activity.
- The user's Gemini API key and its validation status when Direct API mode is configured.
- Direct API usage counters.
- Direct API call-log metadata including video URL, video title, timestamp, selected profile, outcome, HTTP status, and a safe error category.
- Full Direct API prompt and response bodies only when the user enables full call logging.

TL;DW stores short-lived prompt handoff and destination-tab state in `chrome.storage.session`.
TL;DW never persists the full YouTube transcript.
History expiration is configurable and defaults to 30 days.
The summary cache expires entries after seven days and is capped at 300 prompt variants.
Uninstalling the extension removes extension storage from the Chrome profile.

## Data sent from your device

TL;DW sends data only through the following product features.

1. In open-in-a-tab mode, TL;DW submits the generated prompt and available transcript to the selected Gemini, ChatGPT, or Claude website under the user's signed-in account.
2. In NotebookLM mode, TL;DW adds the YouTube link as a source.
3. In Direct API mode, TL;DW sends the generated prompt and transcript to Google's Generative Language API.
4. When SponsorBlock is enabled, TL;DW sends the current YouTube video ID to the public SponsorBlock API to retrieve sponsor segments.

Direct API mode uses a Gemini key supplied by the user.
The key remains in `chrome.storage.local` and is sent only to Google's API in the `x-goog-api-key` request header.
The key is never placed in a request URL and is never sent to the developer.
Key verification reads metadata for the fixed Gemini 3.1 Flash-Lite model and does not generate a summary.

The user's chosen AI service and Google project terms apply to data sent to those services.
TL;DW sends no analytics, telemetry, crash reports, history, summaries, or usage counters to the developer.

## Data TL;DW does not collect

- TL;DW does not collect watch time, engagement, ratings, or WATCH/SKIM/SKIP classifications.
- TL;DW does not sell user data.
- TL;DW does not use data for advertising, profiling, creditworthiness, or lending.
- TL;DW does not operate a server that receives extension data.

## Permissions

- `storage` stores settings, profiles, history, parsed summary-cache variants, usage, call-log data, and session handoff state.
- `tabs` opens AI destinations, reads the active YouTube tab's URL and title, requests transcript and video metadata from the content script, and focuses an existing destination tab.
- `contextMenus` provides the YouTube right-click summary menu.
- `clipboardWrite` copies a prompt only when the user requests it or auto-fill fallback requires it.
- Host access to `youtube.com` reads the page and transcript and renders the summary panel.
- Host access to Gemini, ChatGPT, Claude, and NotebookLM fills the destination selected by the user and reads the completed answer for on-page display.
- Host access to `generativelanguage.googleapis.com` supports key verification and Direct API summaries.
- Host access to `sponsor.ajay.app` retrieves SponsorBlock segments by YouTube video ID.

## Changes

Material changes to this policy will be reflected here with an updated date.
