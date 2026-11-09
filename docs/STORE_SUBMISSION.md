# Chrome Web Store Submission Guide

This is the source for the TL;DW Chrome Web Store listing (updated for v1.2.1, 2026-11-09).
Each field is in its own block; copy the text inside the block.
The owner's step-by-step checklist is item 3 in [OWNER-TODO.md](../OWNER-TODO.md).

## Package

Build from a clean checkout of the release tag, without changing the version, then validate:

```bash
git checkout v1.2.1 && npm ci
npm run package            # web-store/tldw-<version>.zip
npm run validate:package   # manifest at the root, base hosts only, no source maps or keys
```

The upload ZIP must contain `manifest.json` at its root with the version in `package.json`.

## Store listing tab

### Name (comes from the manifest, nothing to type)

```
TL;DW: YouTube Summaries with Gemini
```

At least six store items are already called TLDW or TL;DW, so the listing name says what it does.
Everywhere inside the extension it is still TL;DW.

### Summary (comes from the manifest description, 127 of 132 characters)

```
Too Long; Didn't Watch: summarize any YouTube video right on the page with Gemini, or send it to ChatGPT, Claude or NotebookLM.
```

### Description

```
Get the point of a YouTube video without watching all of it.

Press the blue TL;DW button under any video and a summary appears right on the page: one line with the main takeaway, and the key details a click away.

It works with no setup. TL;DW opens Gemini in a background tab, with the Google account you already use there (or none), and brings Gemini's answer back to the video.
For summaries in seconds with no extra tab, add your own free Gemini API key. It takes about two minutes in Google AI Studio, and TL;DW walks you through it.
With a key, long videos are summarized from the whole transcript, and Gemini can watch videos that have no captions.

Not sure yet? "See an example summary" on the welcome page shows a real summary TL;DW made, with no key and no setup.

What you can do:
- Summarize with a click, the keyboard shortcut (Alt+Shift+G), or the right-click menu.
- Pick a prompt profile: the short TL;DW, research notes, a learning brief, a tutorial brief, or the best moments to watch. Edit them or write your own.
- Ask a specific question about the video.
- Summarize long videos, or chosen channels, automatically.
- Send the video to ChatGPT, Claude or NotebookLM instead of Gemini.
- Tag videos and channels, and find past summaries in your history.
- Optionally skip community-reported sponsor segments with SponsorBlock (off by default).

Private by design:
- No accounts, no analytics, no tracking, and no developer server.
- Settings, history and cached summaries stay in Chrome on your device.
- Your Gemini key is sent only to Google.
- TL;DW never downloads or saves a video's audio, video or images.

TL;DW is open source (MIT): github.com/n8watkins/tl-dw
```

### Category

```
Productivity > Tools
```

### Language

```
English (United States)
```

### Graphic assets (all in `store-assets/`)

- Store icon (128x128): `store-icon-128.png`.
- Screenshots (1280x800), in this order:
  1. `01-summary-on-the-page-1280x800.png`
  2. `02-key-details-1280x800.png`
  3. `03-works-with-no-setup-1280x800.png`
  4. `04-example-summary-1280x800.png`
  5. `05-prompt-profiles-1280x800.png`
- Small promo tile (440x280): `promo-tile-440x280.png`.
- Marquee promo tile (1400x560, optional): `marquee-1400x560.png`.

### Additional fields

- Official URL: leave as "None" (it needs a verified site in Search Console).
- Homepage URL: `https://n8builds.dev/builds/tldw`
- Support URL: `https://github.com/n8watkins/tl-dw/issues`
- Mature content: No.

## Privacy practices tab

### Single purpose description

```
TL;DW summarizes the YouTube video you are watching. When you ask, it sends the video's transcript (or its link) with a summary prompt to the AI service you choose, either the Gemini web app in a tab or the Gemini API with your own key, and shows the summary on the YouTube page. Prompt profiles, tags, history, caching and the optional sponsor-segment skipping all serve that one purpose.
```

### Permission justifications

storage:

```
Saves the user's settings, prompt profiles, tags, local summary history, a cache of parsed summaries, the user's own Gemini API key, usage counters, and the short-lived prompt waiting for the AI tab. Everything stays in Chrome on the device.
```

contextMenus:

```
Adds a right-click menu on YouTube pages and video links ("Send to Gemini with...") so the user can summarize a video with a chosen prompt profile.
```

clipboardWrite:

```
Copies the generated prompt to the clipboard when the user asks for it, or when the AI site's message box can't be filled automatically, so the user can paste it. TL;DW never reads the clipboard.
```

scripting:

```
Registers TL;DW's prompt-filling script on chatgpt.com, claude.ai or notebooklm.google.com only after the user picks that site and grants its optional host permission, and removes it if the permission is revoked.
```

Host permission justification (one field covers all hosts):

```
https://www.youtube.com/* : reads the transcript and title of the video the user asks to summarize (the same transcript YouTube shows in its "Show transcript" panel), adds the TL;DW button and the summary panel under the video, and follows YouTube's in-page navigation.
https://gemini.google.com/* : the default mode needs no API key. TL;DW opens Gemini in a tab, fills in and sends the prompt, and reads the finished answer to show it on the YouTube page.
https://generativelanguage.googleapis.com/* : the Gemini API. Used only when the user adds their own API key: to verify the key and to request summaries.
Optional, requested only when the user picks the feature: https://chatgpt.com/* and https://claude.ai/* (fill the prompt and read the answer), https://notebooklm.google.com/* (add the video link as a source), https://sponsor.ajay.app/* (look up sponsor segments by video ID when SponsorBlock skipping is turned on).
```

### Remote code

```
No, I am not using remote code.
```

All JavaScript ships in the package; the only network requests are data requests to YouTube, Gemini, the Gemini API and, when the user opts in, ChatGPT, Claude, NotebookLM and SponsorBlock.

### Data usage: what to tick

Tick these four, and leave the rest unticked:

- **Website content**: the video's transcript, title, channel and link are sent with the prompt to the AI service the user picks, and the AI's answer is read back from that site.
- **Authentication information**: the user's own Gemini API key, stored on the device and sent only to Google's Gemini API.
- **User activity**: local counters of summaries made, cache hits and sponsor segments skipped.
- **Web history**: the local summary history (video link, title, channel, time); and with SponsorBlock turned on, the ID of each opened YouTube video is sent to the SponsorBlock API.

Leave unticked: Personally identifiable information, Health information, Financial and payment information, Personal communications, Location.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```
https://n8builds.dev/privacy/tldw
```

Until n8watkins/n8builds-web PR #165 is merged and deployed, use the same policy on GitHub instead:

```
https://github.com/n8watkins/tl-dw/blob/master/PRIVACY.md
```

## Distribution tab

- Payments: Free of charge.
- Visibility: Unlisted for the first submission, then Public.
- Regions: All regions.

## Test instructions (reviewer note)

Paste this into "Test instructions" (Additional test instructions on the Privacy or Distribution tab, depending on the dashboard version).

```
What TL;DW does: it summarizes the YouTube video the user is watching and shows the summary under the video. Nothing else.

Nothing from YouTube is downloaded or stored. TL;DW does not download, save or re-host any video, audio, image or caption file, and it does not block ads. When the user asks for a summary, it reads the video's transcript text, the same text YouTube shows in its own "Show transcript" panel, and sends it with a prompt to the AI service the user chose. Only the generated summary is kept, on the user's device. Local history keeps the video's link, title and channel, never the transcript.

How to test, no account or key needed:
1. Install TL;DW. A welcome page opens.
2. Click "See an example summary" to see a real summary TL;DW made, shipped with the extension. This page needs no key and sends nothing.
3. Open https://www.youtube.com/watch?v=UF8uR6Z6KLc and press the blue TL;DW button under the video (next to Subscribe), or press Alt+Shift+G.
4. TL;DW opens Gemini (gemini.google.com) in a background tab, sends the prompt there and, after about 10 to 60 seconds, shows the summary under the video. Being signed in to Google is optional. "Show details" expands it.

With a Gemini API key (optional, free at https://aistudio.google.com/apikey): open TL;DW's settings, go to Direct API, paste the key and save. TL;DW verifies it and turns Direct API on; summaries then appear in a few seconds with no extra tab.

About the youtube.com scripts: a small script in the page's main world wraps window.fetch only to read the responses of YouTube's own transcript requests (get_panel, get_transcript, timedtext) for the video on screen. It does not read cookies, headers or any other response. If YouTube's own transcript request fails, it asks YouTube for that same transcript panel itself, without the user's cookies.

ChatGPT, Claude, NotebookLM and SponsorBlock are optional host permissions, requested only when the user picks them. SponsorBlock skipping is off by default.

Privacy policy: https://n8builds.dev/privacy/tldw
Source code: https://github.com/n8watkins/tl-dw
```
