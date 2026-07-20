# Chrome Web Store Submission Guide

This guide is the source for the TL;DW 1.0.0 unlisted Chrome Web Store soft launch.

## Build artifact

Build without changing the version, then package the verified output.

```bash
npx vite build
npm run package
```

The upload ZIP must contain `manifest.json` at its root with version `1.0.0`.
The ZIP must not contain source maps, secrets, development assets, or stale artifacts.

## Listing

**Name:** `TL;DW`

**Category:** Productivity

**Language:** English

**Short description:**

> Summarize YouTube videos inline with your own Gemini key, custom profiles, private local history, and SponsorBlock.

**Detailed description:**

> Get the substance of a YouTube video without watching the whole thing.
>
> TL;DW adds a concise AI summary to the YouTube page.
> Direct API mode uses your own Google Gemini key, with no shared developer key and no developer backend.
> Gemini 3.1 Flash-Lite is recommended because it currently offers the highest free-tier allowance at up to 500 requests per day as of July 2026.
> You can remain on the free tier or attach billing to your own Google project for additional capacity.
>
> Choose reusable prompt profiles, add per-channel or per-video tags, ask a specific question, auto-summarize selected channels or long videos, and reuse exact prompt-aware cached results.
> You can also use open-in-a-tab mode with Gemini, ChatGPT, Claude, or NotebookLM.
> SponsorBlock integration can automatically skip community-reported sponsor segments.
>
> Settings, history, parsed summary cache, usage counters, and API call metadata stay in Chrome local storage.
> TL;DW has no accounts, analytics, telemetry, or developer-owned backend.

## Single purpose

> TL;DW sends the current YouTube video and generated summary prompt to the AI service selected by the user, or to the user's own Gemini API key, to produce an on-page summary.
> Local history, profiles, tags, prompt-aware caching, usage counters, and SponsorBlock skipping support that single video-summary purpose.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Stores settings, profiles, tags, transcript-free history, parsed prompt-aware summary-cache variants, Gemini key-validation metadata, usage counters, Direct API call-log data, lifetime stats, and short-lived prompt handoff state. |
| `tabs` | Opens the selected AI destination, reads the active YouTube URL and title, messages the YouTube content script for transcript and video metadata, and focuses a previously opened destination tab. |
| `contextMenus` | Adds a YouTube-scoped right-click menu for summarizing with a selected prompt profile. |
| `clipboardWrite` | Copies a generated prompt when the user requests it or when destination auto-fill fallback requires it. TL;DW never reads the clipboard. |
| `https://www.youtube.com/*` | Reads the current video's transcript and metadata, renders the on-page summary, handles SPA navigation, and supports SponsorBlock controls. |
| `https://gemini.google.com/*` | Fills and submits the user's prompt when Gemini is selected in open-in-a-tab mode and reads the completed answer for on-page display. |
| `https://chatgpt.com/*` | Fills and submits the user's prompt when ChatGPT is selected and reads the completed answer for on-page display. |
| `https://claude.ai/*` | Fills and submits the user's prompt when Claude is selected and reads the completed answer for on-page display. |
| `https://notebooklm.google.com/*` | Adds the YouTube link as a NotebookLM source when NotebookLM is selected. |
| `https://generativelanguage.googleapis.com/*` | Verifies the user's saved key against Gemini model metadata and sends Direct API `generateContent` requests using that key. |
| `https://sponsor.ajay.app/*` | Retrieves SponsorBlock segment timestamps using the current YouTube video ID. |

## Data-use declarations

Declare **Website content**.
TL;DW processes the video transcript, URL, title, channel, duration, generated prompt, and parsed AI summary.
History stores a transcript-free prompt and video metadata.
The local cache stores parsed summaries with prompt fingerprints and profile metadata.
The full transcript is sent live for summarization and is never persisted.

Declare **Authentication information**.
Direct API mode stores the user's Gemini key in `chrome.storage.local`.
The key leaves the device only in the `x-goog-api-key` header sent to Google's Generative Language API.
The key is never placed in a URL and is never sent to the developer.

Declare **User activity**.
TL;DW stores local summary history, usage attempts, outcomes, cache hits, and SponsorBlock counters.
TL;DW does not track watch time, engagement, ratings, or WATCH/SKIM/SKIP classifications.

Certify that data is not sold, is not used outside the extension's single purpose, and is not used for creditworthiness or lending.
TL;DW has no developer-owned backend and collects no telemetry.

## Store assets

Required assets are the 128 by 128 icon, at least one 1280 by 800 screenshot, and one 440 by 280 promotional tile.
Up to five screenshots are recommended.

1. Show the populated on-page summary from Direct API mode.
2. Show the popup with destination, profile, specific-question, and Direct API controls.
3. Show the summary activity and usage views.
4. Show SponsorBlock segment controls and Undo.
5. Show profile, destination, tag, and channel summary distributions.

The promotional tile should show the TL;DW wordmark, a long-video cue, and the concise summary panel.
Use the headline "Know it before you watch."
Do not show API keys, account identifiers, private history, or unrelated browser UI.

## Reviewer notes

The MAIN-world script wraps `window.fetch` only to observe YouTube transcript responses from the transcript endpoints.
It does not read request headers, cookies, authentication data, or unrelated responses.
The isolated content script receives only the transcript content needed for the requested summary.

In open-in-a-tab mode, TL;DW fills the selected AI site and reads the completed assistant answer so it can display the parsed summary on YouTube.
The parsed summary may be stored in the local prompt-aware cache, but the raw destination-site answer is not persisted.
Full prompt and response logging applies only to Direct API calls when the user explicitly enables it.

## Distribution

Submit version 1.0.0 with visibility set to **Unlisted**.
Promote to Public only after an unlisted smoke cohort confirms the BYOK flow and no policy changes are required.
