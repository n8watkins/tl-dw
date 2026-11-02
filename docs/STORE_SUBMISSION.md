# Chrome Web Store Submission Guide

This guide is the source for the TL;DW Chrome Web Store listing (updated for v1.1.0, 2026-11-02).

## Build artifact

Build without changing the version, then package the verified output.

```bash
npx vite build
npm run package
```

The upload ZIP must contain `manifest.json` at its root with the version in `package.json`.
`npm run validate:package` also checks that the base install asks only for YouTube, Gemini and the Gemini API.
The ZIP must not contain source maps, secrets, development assets, or stale artifacts.

## Listing

**Name:** `TL;DW`

**Category:** Productivity

**Language:** English

**Short description:**

> Summarize any YouTube video right on the page with Gemini. Works without a key; add a free Gemini key for instant summaries.

**Detailed description:**

> Get the substance of a YouTube video without watching the whole thing.
>
> Press the TL;DW button under any video and the summary appears right on the page: a one-line takeaway plus the key details.
>
> It works with no setup: TL;DW opens Gemini in a background tab, using the Google account you're signed in with, and brings its answer back to the video.
> For summaries in seconds with no tab, add your own free Gemini API key (about two minutes in Google AI Studio; TL;DW walks you through it).
> With a key, long videos are summarized from the full transcript, and Gemini watches videos that have no captions.
>
> Shape summaries with reusable prompt profiles, channel and video tags, or a specific question.
> Summarize long videos or chosen channels automatically.
> Prefer another assistant? Send the video to ChatGPT, Claude or NotebookLM instead.
> Optional SponsorBlock integration skips community-reported sponsor segments.
>
> Settings, history and cached summaries stay in Chrome on your device.
> TL;DW has no accounts, analytics, telemetry or developer backend, and your key is sent only to Google.

## Single purpose

> TL;DW summarizes the YouTube video you are watching: it sends the video's transcript (or link) and a summary prompt to the AI service you choose, or to the Gemini API with your own key, and shows the summary on the YouTube page.
> Profiles, tags, local history, caching, usage counters and optional SponsorBlock skipping support that single purpose.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Stores settings, profiles, tags, transcript-free history, the parsed summary cache, the user's Gemini key and its verification status, usage counters, the Direct API call log, lifetime stats, and short-lived prompt hand-off state. |
| `contextMenus` | Adds a YouTube-scoped right-click menu for summarizing with a chosen prompt profile. |
| `clipboardWrite` | Copies a generated prompt when the user asks, or when a destination's message box can't be filled. TL;DW never reads the clipboard. |
| `scripting` | Registers TL;DW's prompt filler on ChatGPT, Claude or NotebookLM only after the user grants that optional site. |
| `https://www.youtube.com/*` | Reads the current video's transcript and details, shows the on-page summary panel, handles in-page navigation, and runs the optional SponsorBlock skipping. |
| `https://gemini.google.com/*` | Fills and submits the prompt in the Gemini tab (the default, no-key mode) and reads the finished answer for the on-page summary. |
| `https://generativelanguage.googleapis.com/*` | Verifies the user's own Gemini key and sends Direct API summary requests with it. |
| Optional `https://chatgpt.com/*`, `https://claude.ai/*` | Requested when the user picks ChatGPT or Claude: fills the prompt and reads the finished answer. |
| Optional `https://notebooklm.google.com/*` | Requested when the user picks NotebookLM: adds the video link as a source. |
| Optional `https://sponsor.ajay.app/*` | Requested when the user turns on SponsorBlock: looks up sponsor segments by video ID. |

## Data-use declarations

Declare **Website content**.
TL;DW processes the video transcript, URL, title, channel, duration, generated prompt, and parsed AI summary.
History stores a transcript-free prompt and video metadata.
The local cache stores parsed summaries with prompt fingerprints and profile metadata.
The full transcript is sent live for summarization and is never persisted.

Declare **Authentication information**.
Direct API mode stores the user's own Gemini key in `chrome.storage.local`.
The key leaves the device only in the `x-goog-api-key` header sent to Google's Generative Language API.
The key is never placed in a URL and is never sent to the developer.

Declare **User activity**.
TL;DW stores local summary history, usage attempts, outcomes, cache hits, and SponsorBlock counters.
With SponsorBlock turned on (it is off by default), the ID of each opened YouTube video is sent to the SponsorBlock API.
TL;DW does not track watch time, engagement, ratings, or WATCH/SKIM/SKIP classifications.

Certify that data is not sold, is not used outside the extension's single purpose, and is not used for creditworthiness or lending.
TL;DW has no developer-owned backend and collects no telemetry.

## Store assets

Required assets are the 128 by 128 icon, at least one 1280 by 800 screenshot, and one 440 by 280 promotional tile.
Up to five screenshots are recommended.

1. Show the populated on-page summary from Direct API mode.
2. Show the welcome page with the two modes and the free-key steps.
3. Show the popup with destination, profile, specific-question, and Direct API controls.
4. Show the summary activity and usage views.
5. Show the Direct API model picker and key status.

The promotional tile should show the TL;DW wordmark, a long-video cue, and the concise summary panel.
Use the headline "Know it before you watch."
Do not show API keys, account identifiers, private history, or unrelated browser UI.

## Reviewer notes

The MAIN-world script wraps `window.fetch` only to observe YouTube transcript responses from the transcript endpoints.
It does not read request headers, cookies, authentication data, or unrelated responses.
The isolated content script receives only the transcript content needed for the requested summary.

The Gemini web app is the default destination and needs no key.
ChatGPT, Claude, NotebookLM and SponsorBlock are optional host permissions requested at the moment the user picks them.

In open-in-a-tab mode, TL;DW fills the selected AI site and reads the completed assistant answer so it can display the parsed summary on YouTube.
The parsed summary may be stored in the local prompt-aware cache, but the raw destination-site answer is not persisted.
Full prompt and response logging applies only to Direct API calls when the user explicitly enables it.

## Distribution

Submit the current version with visibility set to **Unlisted**.
Promote to Public only after an unlisted smoke cohort confirms the BYOK flow and no policy changes are required.
