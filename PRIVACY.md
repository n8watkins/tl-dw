# TL;DW - Privacy Policy

_Last updated: November 2, 2026 (extension v1.1.0)_

TL;DW summarizes YouTube videos.
It has no developer backend, no accounts, no shared API key, and no analytics, tracking or telemetry.
Nothing TL;DW handles is ever sent to the developer.
Its data stays in Chrome's extension storage on your device, except for what it sends to the services described below when you use them.

## What is sent where

What leaves your device depends on how you summarize a video.

### Without a Gemini API key (the default)

- TL;DW opens the AI site you chose (Gemini by default, or ChatGPT, Claude or NotebookLM) in a tab, under the account you are signed in with there.
- It types a prompt into that site's message box: your prompt profile's instructions, the video's title, channel and link, any question you typed, and the video's transcript when it fits the site's message box.
- When the transcript is too long for the Gemini web app, or there is none, Gemini gets the video's link instead and watches the video itself.
  For ChatGPT and Claude, TL;DW asks you on the page first and sends only what you choose.
- NotebookLM gets the video's link as a source.
- TL;DW then reads the site's answer in that tab to show the summary on the YouTube page.
- That site's own terms and privacy policy apply to what it receives.

### With your own Gemini API key (Direct API)

- TL;DW sends the prompt and the video's full transcript to Google's Gemini API (`generativelanguage.googleapis.com`).
- When a video has no transcript, it sends the video's YouTube link instead, and Gemini watches the video (public videos only).
- Your key is sent only to that API, in the `x-goog-api-key` request header; never in a URL, and never to the developer.
- Checking a newly saved key reads the chosen model's details from the API; it does not send a prompt.
- Google's [Gemini API terms](https://aistudio.google.com/docs/terms) apply.
  On the free tier ("Unpaid Services"), Google may use what you send and the responses to provide, improve and develop its products, and human reviewers may read them.
  Do not use the free tier for anything sensitive.
  On a paid tier, Google does not use your prompts or responses to improve its products.

### SponsorBlock (off unless you turn it on)

- When you turn on "Auto-skip sponsored segments" in Settings, Chrome asks you to allow `sponsor.ajay.app`.
- From then on, TL;DW sends the ID of each YouTube video you open, and nothing else, to the public [SponsorBlock](https://sponsor.ajay.app) API to look up community-reported sponsor segments.
- Turning it off stops these requests.

## Data stored on your device

TL;DW stores the following in `chrome.storage.local`, on your device only:

- Settings, prompt profiles and tags.
- Your Gemini API key, if you add one, with its name and whether it was verified.
  The key stays in this storage; anyone with access to your Chrome profile could read it, so you can delete it in TL;DW at any time and revoke it in Google AI Studio.
- Summary history: the video's link, title and channel, the prompt profile, a prompt without the transcript, and the time.
  History is deleted after 30 days by default (configurable).
- A cache of parsed summaries, kept for seven days and capped at 300 entries.
- Summary, cache-hit and SponsorBlock counters, and per-day summary activity.
- Direct API usage counters and a call log of video link, title, time, profile, outcome and error category.
  The full prompt and response are kept only if you turn on full call logging.

Short-lived hand-off state (the prompt waiting for a destination tab, open destination tabs) is kept in `chrome.storage.session` and cleared when Chrome closes.
TL;DW never stores a video's full transcript.
Uninstalling TL;DW removes all of its storage from your Chrome profile.

## What TL;DW does not do

- It does not collect watch time, engagement or ratings.
- It does not sell data, or use it for advertising, profiling, creditworthiness or lending.
- It runs no server that receives your data.

## Permissions

- `storage`: settings, profiles, history, the summary cache, usage counters, the call log and hand-off state.
- `contextMenus`: the "Send to … with…" right-click menu on YouTube.
- `clipboardWrite`: copying a prompt when you ask, or when a site's message box can't be filled.
- `scripting`: adding TL;DW's prompt filler to ChatGPT, Claude or NotebookLM after you allow that site.
- `youtube.com`: reading the video's transcript and details, and showing the summary panel.
- `gemini.google.com`: filling the prompt in the Gemini tab and reading its answer.
- `generativelanguage.googleapis.com`: the Gemini API, used only with your own key.
- Optional, asked for only when you pick them: `chatgpt.com`, `claude.ai` and `notebooklm.google.com` (to fill the prompt there and read the answer), and `sponsor.ajay.app` (SponsorBlock).
  You can remove them any time in Chrome's settings for TL;DW.

## Contact

Questions or concerns: open an issue at [github.com/n8watkins/tl-dw/issues](https://github.com/n8watkins/tl-dw/issues).

## Changes

Material changes to this policy will be published here with a new date.
