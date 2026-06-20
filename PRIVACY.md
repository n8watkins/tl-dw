# TL;DW — Privacy Policy

_Last updated: 2026-06-20 (extension v0.1.156)_

TL;DW is a Chrome extension that summarizes the YouTube video you're watching. It
has **no backend service, no user accounts, and no analytics or tracking.**
Everything it stores lives in Chrome's local storage on your own machine.

## What is stored on your device

All persistent data is kept in `chrome.storage.local` (and ephemeral handoff state
in `chrome.storage.session`) on your computer. None of it is sent to us — there is
no "us" to send it to. This includes:

- Your prompt **profiles** and settings.
- **History** of summaries you've run — a **transcript-free** prompt plus video
  metadata (title, URL, channel, timestamp, your rating). The full transcript is
  **never** stored.
- **Lifetime stats** (summary counts, watch time, sponsor segments skipped and
  seconds saved, engagement totals) and a per-day activity map.
- **Per-channel data and tags** you create.
- Your **Gemini API key**, if you use Direct API mode (stored locally, used only to
  call Google's API — see below).
- A **call log** for Direct API mode that keeps **metadata only by default**
  (timestamps, token/quota counters). It retains prompt and response text only if
  you explicitly turn on "keep full call log" for debugging.

History auto-expires on a schedule you control (7 / 30 / 90 / 365 days, default 30)
and can be cleared at any time. Uninstalling the extension removes all of this
local data.

## What leaves your device, and to whom

TL;DW only sends data to the service you ask it to use. There are exactly three
outbound paths:

1. **Open-in-a-tab mode.** When you send a video to Gemini, ChatGPT, Claude, or
   NotebookLM, TL;DW fills that site's composer with the prompt — and, for AIs that
   can't watch the video (ChatGPT, Claude), the extracted **transcript** — and
   submits it. This goes to the AI site under **your own signed-in account**, exactly
   like any message you type there yourself. That service's own privacy policy
   applies.
2. **Direct API mode (optional).** If you enable it and supply your own Gemini API
   key, TL;DW calls Google's Generative Language API
   (`generativelanguage.googleapis.com`) directly. The request contains your
   **prompt and the video transcript** in the body and **your API key** in the
   request URL. This is a call to Google under your own key; Google's API terms and
   privacy policy apply.
3. **SponsorBlock (optional, on by default).** When sponsor-skip is enabled, TL;DW
   asks the public SponsorBlock community API (`sponsor.ajay.app`) for the sponsor
   segments of the video you're watching. To do this it sends the **YouTube video
   ID** of the current video. No account, key, or personal identifier is sent. Turn
   off sponsor-skip in Settings to stop these lookups.

There are no other network calls. TL;DW sends **no** telemetry, analytics, crash
reports, or usage data anywhere.

## What is never collected

- We **never** store the AI's response (unless you opt into the full call log for
  your own debugging).
- We **never** store the full transcript in history.
- There is **no** advertising, profiling, or selling of data — none is collected in
  the first place.

## Permissions and why they're needed

- `storage` — keep your profiles, settings, history, and stats locally.
- `tabs` — open the destination AI in a tab and read the active YouTube tab's URL.
- `contextMenus` — the right-click "Send to…" entry.
- `clipboardWrite` — the fallback that copies the prompt to your clipboard when a
  site's composer can't be auto-filled.
- Host access to `youtube.com` / `m.youtube.com` (read the page and transcript), the
  four AI destination sites (fill and submit the prompt),
  `generativelanguage.googleapis.com` (Direct API), and `sponsor.ajay.app`
  (SponsorBlock lookups).

## Changes

Material changes to this policy will be reflected here with an updated date. Because
the extension keeps all data locally and contacts only the services described above,
changes will generally track new features rather than new data collection.
