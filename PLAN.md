# TL;DW Product Plan

## Product promise

TL;DW turns a YouTube transcript into a concise summary with one click or keyboard command.
The summary is neutral by default and can be shaped through prompt profiles, tags, and a specific question.

## 1.0 launch position

Version 1.0.0 will launch as Unlisted before any Public distribution.
Direct API mode is bring-your-own-key.
There is no shared developer key, proxy, backend, extension account, or telemetry.

Gemini 3.1 Flash-Lite is the fixed model for 1.0.
It is recommended because it currently offers the highest free-tier allowance at up to 500 requests per day as of July 2026.
Users may remain on the free tier or attach billing to their own Google project.
Paid users should configure a project budget and billing alerts.

## Summary flows

### Direct API

1. The user creates a dedicated Google AI Studio project and key.
2. TL;DW stores the key in `chrome.storage.local` and verifies model metadata.
3. The background worker resolves the effective profile before building the prompt.
4. TL;DW obtains the current transcript and active tags.
5. The worker fingerprints the complete effective prompt and fixed model target.
6. An exact cache match is returned without another inference request.
7. Otherwise, TL;DW counts an attempt and calls Gemini using the `x-goog-api-key` header.
8. A parsed SUMMARY and DETAILS block is cached and displayed on the correct YouTube video.

### Open in a tab

TL;DW opens Gemini, ChatGPT, Claude, or NotebookLM and fills the required prompt or source.
For chat destinations, TL;DW can read the completed response and send the parsed summary back to YouTube.
The background worker caches the parsed result with the original prompt context.

## Profile selection

- Automatic Direct API runs use `directApiProfileId` and fall back to the global default.
- Popup inline runs use the popup-selected profile.
- Manual on-page runs use the global default profile.
- Menu, command, and tab-opening popup runs preserve their existing selected or default profile behavior.

## Local data

Persistent data uses `chrome.storage.local`.
Session prompt handoff and destination state use `chrome.storage.session`.
The full transcript is never persisted.
History keeps a transcript-free prompt and video metadata.
The summary cache keeps bounded prompt-aware parsed-summary variants for seven days.
Direct API usage uses a versioned Pacific quota-day schema.
Call logs keep metadata and outcome by default and keep prompt and response bodies only when the user opts in.

## Release quality gate

The release gate includes typecheck, ESLint, unit tests, built-extension browser tests, production build, package validation, and full dependency audit.
CI must run the same checks for pushes and pull requests.
A manual real-key smoke test is required for each release candidate; the current 1.0.0 candidate has passed it with the saved local key.
Live destination selector checks remain manual because external site DOM structures are volatile.

## Distribution

The first store submission uses Unlisted visibility.
User reports are the monitoring channel because TL;DW has no telemetry.
Public promotion happens only after the unlisted cohort confirms key verification, summary completion, caching, navigation correctness, and policy accuracy.
