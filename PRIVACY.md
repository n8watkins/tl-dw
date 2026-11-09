# TL;DW - Privacy Policy

_Last updated: November 9, 2026 (extension v1.4.0)_

TL;DW summarizes YouTube videos with Google's Gemini, and with no other AI service.
It has no developer backend, no accounts, no shared API key, and no analytics, tracking or telemetry.
Nothing TL;DW handles is ever sent to the developer.
Its data stays in Chrome's extension storage on your device, except for what it sends to the services described below when you use them.

## What is sent where

What leaves your device depends on how you summarize a video.

### Without a Gemini API key (the default)

- TL;DW opens the Gemini web app (`gemini.google.com`) in a tab, under the Google account you are signed in with there, if any.
- It types a prompt into Gemini's message box: your profile's instructions, the video's title, channel and link, any question you typed, and the video's transcript, with the time each caption line starts.
- When the transcript is too long for one message, TL;DW sends it in several messages, then the request.
  Only a transcript longer than about six hours is sent as its start and end, with the middle marked as left out, and the summary is labeled so.
- When there is no transcript, Gemini gets the video's link instead, which only a signed-in Gemini can read.
  Before sending it, TL;DW checks the Gemini page for your account button or a sign-in link (it reads nothing else about the account); signed out, it sends nothing and asks you to sign in.
- TL;DW then reads Gemini's answer in that tab to show the summary on the YouTube page.
- Google's own terms and privacy policy for Gemini apply to what it receives.

### With your own Gemini API key (Direct API)

- TL;DW sends the prompt and the video's full transcript, with the time each caption line starts, to Google's Gemini API (`generativelanguage.googleapis.com`); a transcript too long for one request goes in parts.
- When a video has no transcript, it sends the video's YouTube link instead, and Gemini watches the video (public videos only; a very long one in parts).
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

- Settings, prompt profiles, each channel's default style, and the labels (tags) from before version 1.4.
- Your Gemini API key, if you add one, with its name and whether it was verified.
  The key stays in this storage; anyone with access to your Chrome profile could read it, so you can delete it in TL;DW at any time and revoke it in Google AI Studio.
- Summary history: the video's link, title and channel, the link to the channel's picture, the prompt profile, the prompt that was sent with the transcript left out, and the time.
  History is deleted after 30 days by default (configurable).
- A cache of parsed summaries, kept for seven days and capped at 300 entries.
- Summary, cache-hit and SponsorBlock counters, and per-day summary activity.
- Direct API usage counters and a call log of video link, title, time, profile, outcome and error category.
  The full prompt (which includes the transcript TL;DW sent) and Gemini's response are kept only if you turn on full call logging, which is off by default; the log keeps the last 200 calls, and you can clear it in TL;DW's Direct API settings.

Short-lived hand-off state is kept in `chrome.storage.session`, which Chrome holds in memory and clears when it closes: the open Gemini tabs TL;DW started, the prompt waiting for a Gemini tab, and the timed transcript a Gemini tab was given, kept only to check the times in its answer.
That prompt can include the transcript; TL;DW deletes it once the Gemini tab has it, and ignores one older than 10 minutes.
The timed transcript is deleted when that Gemini tab closes.
Apart from those cases, TL;DW does not store a video's transcript.
TL;DW never downloads or stores a video's audio, video or images.
Uninstalling TL;DW removes all of its storage from your Chrome profile.

## What TL;DW does not do

- It does not collect watch time, engagement or ratings.
- It does not sell data, or use it for advertising, profiling, creditworthiness or lending.
- It runs no server that receives your data.
- The example summary ("See an example summary" on the welcome page and in the popup) ships inside TL;DW and sends nothing.

## Chrome Web Store User Data Policy

TL;DW's use of the information it handles complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including its Limited Use requirements.
It uses that information only to summarize the video you ask about and to show you your own history and settings, transfers it only to Google's Gemini (and SponsorBlock, if you turn it on) to do that, and never sends it to the developer.

## Permissions

- `storage`: settings, profiles, history, the summary cache, usage counters, the call log and hand-off state.
- `contextMenus`: the "Summarize with Gemini as…" right-click menu on YouTube.
- `clipboardWrite`: copying a prompt when you ask, or when Gemini's message box can't be filled.
- `youtube.com`: reading the video's transcript and details, and showing the summary panel.
- `gemini.google.com`: filling the prompt in the Gemini tab and reading its answer.
- `generativelanguage.googleapis.com`: the Gemini API, used only with your own key.
- Optional, asked for only when you turn SponsorBlock on: `sponsor.ajay.app`.
  You can remove it any time in Chrome's settings for TL;DW.

## Contact

Questions or concerns: open an issue at [github.com/n8watkins/tl-dw/issues](https://github.com/n8watkins/tl-dw/issues).

## Changes

Material changes to this policy will be published here with a new date.
