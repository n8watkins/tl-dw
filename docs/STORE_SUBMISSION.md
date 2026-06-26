# Chrome Web Store — Submission Guide

Everything needed to submit TL;DW to the Chrome Web Store: the upload artifact,
the listing copy, the permission justifications, and the data-use disclosures —
plus the step-by-step. Paste the quoted strings straight into the Developer
Dashboard.

> **Readiness:** No hard policy violations and no remotely-hosted code (verified —
> no `eval`/`new Function`/`innerHTML` sinks; all UI is `createElement` +
> `textContent`). Expect a **manual review pass** (normal for an extension that
> reads transcripts via a MAIN-world `fetch` wrapper). Two things a reviewer will
> likely ask about — answers are pre-written in §6.

---

## 0. Code prep — done

- ✅ Dropped the unused `chat.openai.com` host (the extension opens `chatgpt.com`;
  the legacy domain 301-redirects there anyway) — removes an "over-broad host"
  flag.
- ✅ Tightened the transcript `postMessage` to `location.origin` (was `*`).
- ✅ Moved the Gemini key out of the request URL into the `x-goog-api-key` header
  (keeps it out of any proxy/referrer logs).
- ✅ Dropped the `m.youtube.com` host (desktop selectors don't function on mobile) so
  declared scope == working scope.
- ✅ Added a first-run in-popup notice disclosing SponsorBlock (sends the video ID to
  `sponsor.ajay.app`), with a link to turn it off. (TL;DW no longer tracks
  watch-time/engagement — the watch-time engine was removed in `93f8b7b`, so there is
  no engagement tracking left to disclose.)
- ✅ `npm run package` produces a clean, uploadable zip with `manifest.json` at the
  root.

Optional, not blockers (see §7).

## 1. Build the upload package

```bash
npm run package   # -> web-store/tldw-<version>.zip  (manifest.json at the zip root)
```

Upload that `.zip`. Each public upload needs a version **higher** than the last
published one — bump `package.json` (or run `npm run build`, which auto-bumps)
before packaging a new revision.

## 2. Developer account (one-time)

Register at <https://chrome.google.com/webstore/devconsole> and pay the one-time
**$5** registration fee. Two hard requirements before you can publish: (1) **enable
2-Step Verification** on the Google account you publish from — Google enforces this
for all publishers, and the dashboard blocks publishing without it; and (2) **verify
your contact email** in the dashboard. Note the account email can't be changed later,
so choose deliberately.

## 3. Store listing fields

**Name:** `TL;DW`

**Short description** (≤132 chars):

> Summarize any YouTube video before you watch. On-page AI summary, custom profiles, SponsorBlock auto-skip, private local stats.

**Category:** **Productivity** (the value is reclaiming time / deciding what's worth
watching — a focus tool, not entertainment).

**Language:** English.

**Detailed description:**

```
Stop gambling your time on YouTube. TL;DW ("Too Long; Didn't Watch") summarizes a video BEFORE you commit to watching it - so you can decide in seconds whether it is worth your time.

Open any YouTube video, hit Alt+Shift+G, and get a clear AI summary right on the page. Read it, skip the filler, and reclaim the hours you would have lost to videos that never get to the point.

WHY YOU'LL LIKE IT

- Summarize before you watch. A short, on-page summary means no more 20-minute videos that could have been a paragraph.
- Zero new tabs (Direct API mode). With your own free Google Gemini key, the summary appears right on the YouTube page in a tidy widget - nothing else opens.
- Use the AI you already pay for (open-in-a-tab mode). No key? TL;DW opens Gemini, ChatGPT, or Claude with the prompt already typed and submitted, reads the finished answer back, and drops the summary onto the video page for you - attaching the full transcript automatically for AIs that can't watch the video. NotebookLM is supported too: TL;DW adds the video as a source for you (no on-page summary in that mode).
- Make it your own. Reusable prompt profiles (TL;DW, Research, Learning, Tutorial, or your own) plus tags that tweak the prompt for any channel or video.
- Skip the sponsor pitch. Built-in SponsorBlock auto-skips in-video sponsored segments (with one-tap Undo), using the free community database.
- See your summarizing at a glance. Private, local stats: total summaries, the channels you summarize most, profile and destination usage, most-used tags, and a GitHub-style summary-activity heatmap with a day streak.

WHAT YOU GET

- Direct API mode: headless Gemini call on your own free key; summary inline on the page, no tab opens. Free tier covers roughly 500 videos a day, no credit card.
- Open-in-a-tab mode: auto-fills and submits Gemini, ChatGPT, or Claude (and adds the video as a source in NotebookLM); transcript attached for AIs that can't watch; graceful clipboard fallback if a site's composer changes.
- Optional auto-summarize for anything over a length you choose.
- SponsorBlock auto-skip with inline timestamps, a one-tap Undo, and lifetime time-saved tracking.
- Editable prompt profiles (TL;DW, Research, Learning, Tutorial, or your own), tags that modify the prompt per channel or video, an optional "ask something specific" field, and searchable history.
- Summary-activity stats: total summaries, channels you summarize most, prompt-profile and destination usage, most-used tags, and a GitHub-style activity heatmap with a day streak. All counted locally.
- Right-click menu to summarize with a specific profile, and the Alt+Shift+G keyboard shortcut.
- Works on standard YouTube watch pages; Shorts are supported via the popup (sent to Gemini, which watches the video directly).

PRIVACY

Everything stays on your machine. No backend, no accounts, no analytics - all data lives in Chrome's local storage, your Gemini key is used only to call Google's API, and TL;DW never stores the full transcript.

TL;DW is not affiliated with, endorsed by, or sponsored by YouTube, Google, OpenAI, or Anthropic. YouTube, Gemini, and NotebookLM are trademarks of Google LLC; ChatGPT is a trademark of OpenAI; Claude is a trademark of Anthropic.
```

## 4. Privacy practices tab

**Privacy policy URL** — paste your public `PRIVACY.md` link, e.g.
`https://github.com/n8watkins/tl-dw/blob/master/PRIVACY.md`

**Single purpose:**

> TL;DW sends the YouTube video you are watching to an AI chat assistant (Gemini, ChatGPT, Claude, or NotebookLM) — or to your own Gemini API key — to generate an on-page summary, so you can decide what to watch without watching the whole thing. Supporting features (SponsorBlock sponsor-skip, local summary-activity stats, and local history) all serve that single purpose of triaging and summarizing YouTube videos.

**Permission justifications** (paste per item):

| Permission | Justification |
|---|---|
| `storage` | Persists the user's settings, prompt profiles, summarized-video history, summary cache, tags, and lifetime stats in `chrome.storage.local`, and uses `chrome.storage.session` to hand a built prompt from the background worker to the destination tab's content script. All data stays on the device; nothing is synced to a server. |
| `tabs` | Opens the chosen AI destination in a new tab and delivers the prompt to it, reads the active tab's URL/title to know which YouTube video to summarize, messages the YouTube content script for the transcript and channel/duration metadata, and re-focuses an existing summary tab instead of opening a duplicate. (`activeTab` is insufficient — the tab-reuse + background-open flows enumerate tabs.) |
| `contextMenus` | Adds a "Send to <destination> with…" right-click submenu (scoped to youtube.com) listing the user's prompt profiles, so the current page or a right-clicked video thumbnail can be summarized in one click. |
| `clipboardWrite` | Copies the generated prompt to the clipboard as a fallback when auto-filling the AI chat box fails, and powers the "Copy prompt" button in History. Used only on an explicit failure path or button click; nothing is read from the clipboard. |
| `https://www.youtube.com/*` | Runs the content scripts that read the current video's transcript and channel/duration metadata, render the in-page TL;DW summary panel, and auto-skip sponsor segments. This is the page being summarized. |
| `https://gemini.google.com/*` | When Gemini is the chosen destination, a content script auto-fills the prompt into the Gemini composer and submits it. |
| `https://chatgpt.com/*` | When ChatGPT is the chosen destination, a content script auto-fills the prompt into the ChatGPT composer and submits it. |
| `https://claude.ai/*` | When Claude is the chosen destination, a content script auto-fills the prompt into the Claude composer and submits it. |
| `https://notebooklm.google.com/*` | When NotebookLM is the chosen destination, a content script auto-fills the prompt/source into the NotebookLM UI. |
| `https://generativelanguage.googleapis.com/*` | Direct API mode calls the user's own Gemini API key (`generateContent`) from the background worker to generate the on-page summary headlessly, instead of opening a chat tab. Only when the user has enabled Direct API and entered their key. |
| `https://sponsor.ajay.app/*` | Fetches sponsored-segment timestamps for the current video from the free, key-less SponsorBlock community API (by 11-char YouTube video ID) so the extension can auto-skip ads. Runs in the background worker so host permissions bypass CORS; only the video ID is sent. |

**Data use — categories to declare:**
- **Website content** — the video transcript, title, channel, duration, and the AI summary. Stored locally; leaves the device only as the prompt the user sends to their chosen AI (or to the Gemini API in Direct mode). History stores a transcript-*free* copy; the full transcript is only sent live, never persisted.
- **Authentication information** — the user's own Gemini API key. Stored locally; leaves the device only as the `key=` parameter on the user's own request to Google's Gemini endpoint. Never sent to the developer or anyone else.
- **User activity** — summary counts, sponsor-skip counts, history. All local; none of it is transmitted anywhere. (TL;DW does **not** track watch-time or engagement — the watch-time engine was removed in `93f8b7b`, so the extension collects *less* activity data than earlier builds.)

**The three required certifications — check all three (all true):**
1. *I do not sell or transfer user data to third parties outside the approved use cases.* ✅ The only outbound flows are the user-initiated AI summary request and the key-less SponsorBlock video-ID lookup.
2. *I do not use or transfer user data for purposes unrelated to my item's single purpose.* ✅ All handling serves summarizing/triaging the current video.
3. *I do not use or transfer user data to determine creditworthiness or for lending.* ✅ Never.

There is **no developer-owned backend**; the extension collects nothing for itself.

## 5. Graphics

**Required to submit** (the dashboard blocks review without them): the 128×128 icon
(✅ have it), **≥1 screenshot at 1280×800**, and the **440×280 small promo tile**.
Only the 1400×560 marquee tile is optional. The screenshots and the promo tile **do
not exist yet — you must create them** (briefs below); these are the only two hard
blockers left before submission.

- **Store icon 128×128:** ✅ already in `public/icons/tl-dw-128.png`.
- **Screenshots (1280×800 — REQUIRED, at least 1, up to 5):** capture in this order —
  1. **On-page summary (the money shot).** A real watch page with the
     TL;DW widget populated in Direct API mode: the summary text on a recognizable
     long talk/tutorial.
  2. **Popup — one-keystroke send.** Popup over a video: title button, destination
     grid (Gemini/ChatGPT/Claude/NotebookLM), profile dropdown, "ask something
     specific" field, Ask button with the Alt+Shift+G label, and the "Direct API
     (no new tab)" checkbox + call counter.
  3. **Summary stats — headline + heatmap.** A populated stats view: "Summaries
     created" hero tiles and the GitHub-style summary-activity heatmap with the
     day-streak badge and "Tracking since".
  4. **SponsorBlock auto-skip.** Widget showing detected segments with timestamps
     and the "skipped — Undo" state; lifetime sponsor-time-saved nearby.
  5. **Stats — channels, profiles & tags.** The "Channels you summarize most"
     list with avatar cards, prompt-profile and destination usage bars, and the
     most-used tags.
- **Small promo tile 440×280 (REQUIRED):** Split frame on the dark neon-purple bg. Left (~55%):
  a faux YouTube title bar with a long duration chip (e.g. "27:41") dimmed. Right
  (~45%): the TL;DW widget card with two or three summary lines. Top-left "TL;DW"
  wordmark + "Too Long; Didn't Watch" tagline. Headline: **"Know it before you
  watch."** Minimal words so it reads at 440×280.

## 6. Submit — and the two reviewer questions to expect

Upload the zip and fill the above. In the **Distribution** tab, set visibility to
**Public** (or **Unlisted** for a soft launch you share by link before going fully
public), leave region defaults (all regions), then submit for review. If a reviewer
asks about the two "magnets," reply with:

**MAIN-world fetch interception:**
> A MAIN-world script wraps `window.fetch` ONLY to read YouTube's own transcript
> responses (`get_transcript` / `timedtext`) so the summary works regardless of
> DOM layout. It captures response bodies for those two endpoints only, relays them
> to our isolated content script, and never touches request headers, cookies, auth,
> or any other URL. Nothing is sent to any server we control. See PRIVACY.md.

**Reading the AI's answer out of the destination tab:**
> When the user sends a video to their own signed-in AI, we fill the prompt and read
> back only the assistant's final answer to display it on the YouTube page. The text
> never leaves the user's browser and is not stored unless the user opts into a debug
> log.

## 7. Optional follow-ups (not blockers)

- **Brand logos.** All four Gemini/ChatGPT/Claude/NotebookLM marks are inline SVGs
  in `src/lib/DestinationIcon.tsx` (no bundled brand PNGs). Trademark owners can
  request removal on a public listing. Kept for now (used only to label destinations,
  nominative) — to de-risk, swap to neutral monogram chips and never put a third-party
  logo in the store screenshots/promo tile.
- **Version.** `0.1.171` signals beta; consider bumping to `1.0.0` for the public
  listing (cosmetic, not a rejection issue).
- **Live-key test.** The Gemini key now goes via the `x-goog-api-key` header — do a
  30-second Direct-API summary with a real key to confirm the call still works.
