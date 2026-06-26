# TL;DW — Product Plan

> **TL;DW = "Too Long; Didn't Watch."**
>
> **Thesis:** A Chrome extension that turns "I want to ask an AI about this YouTube video" into a single keystroke.
>
> **Core promise:** It saves the *search*, not the *answer*. That keeps the extension simple, private, fast, and buildable.

> _Refreshed 2026-06-20 to match the shipped product. The original plan was Gemini-only;
> TL;DW now sends to several destinations, extracts the transcript, calls Gemini
> directly (headless on-page summaries), and skips sponsors. History below is
> preserved where still accurate._
>
> _**Re-scoped 2026-06-25 to a focused YouTube summarizer.** Its stats are now
> **summary-centric** (# summaries created, top channels by summaries,
> profile/destination usage, most-used tags, a summary-activity heatmap + streak) —
> not watch/engagement. The **post-watch watch-time + engagement analytics are being
> split out** into a separate local-only companion extension, **Watchprint**
> (`../watchprint`); the watch-time engine still runs under the hood pending removal
> but is no longer surfaced. Rationale + plan: [`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md)
> and `../watchprint/PLAN.md`._

---

## 1. The spine, in one sentence

On a YouTube tab, press **Alt+Shift+G** (or use the popup / right-click menu) → grab the URL → build the default prompt → open the chosen destination → auto-fill its composer → submit. The user reads the answer instead of watching the whole video.

That single motion *is* the product. Everything else is management UI layered on top.

---

## 2. How the motion works

| # | Piece | Responsibility |
|---|-------|----------------|
| 1 | **Entry points** | `chrome.commands` (Alt+Shift+G), the popup, and a YouTube right-click menu |
| 2 | **YouTube side** | Read the active tab's URL; on demand, extract the transcript and read duration/channel |
| 3 | **Handoff** | Build prompt, stash it keyed by tab id in `chrome.storage.session`, open the destination |
| 4 | **Destination side** | A content script waits for the composer, injects the prompt, submits, and reports the outcome |

**Piece #4 is the whole ballgame.** See §3.

### Destinations

| Destination | Delivery | Content |
|-------------|----------|---------|
| **Gemini** | inject + submit | prompt only — Gemini watches the URL itself (`canWatch`) |
| **ChatGPT / Claude** | inject + submit | prompt **with the transcript appended** (they can't watch the video) |
| **NotebookLM** | inject into the "Websites" source | the YouTube link (`payload: "link"`) |

Adding a destination is a one-line registry entry in `constants.ts` plus, if it auto-fills, a `configForHost` block in `inject.ts`.

### Handoff detail (avoid the multi-tab race)

If the user fires twice quickly, two destination tabs open and each must pick up *its own* prompt.

1. Background opens the tab and gets the new `tabId`.
2. Background stores `pending[tabId] = prompt` in `chrome.storage.session`.
3. The destination content script reads the prompt for *its own* tab id, injects it, then clears that key.

---

## 3. The #1 risk: auto-injecting into someone else's web app

The existential risk isn't "can the model help" — it's:

> **Can we reliably inject text into a composer we don't control and trigger send?**

These composers are **contenteditable rich-text divs, not plain `<textarea>`s**. Consequences:

- Setting `.value` does nothing. We simulate input (`execCommand("insertText")` / native setter + `InputEvent`) so the site's framework registers the text and **enables** the send button.
- The send trigger is a click on the (initially disabled) send button once input is detected.
- Each site's DOM/class names change without notice, so selectors **will** break periodically.

This is the classic "works in the demo, silently breaks in 3 months" feature. Therefore:

### Non-negotiable rule: graceful fallback + visible failure

> If injection fails, **copy the prompt to clipboard** and leave the tab open with a toast: *"Prompt copied — paste to send."* Never leave the user staring at an empty box.

And, shipped since: the injector **reports each outcome** to the background, which records it and flashes the toolbar badge. The popup shows a red alert naming the site and reason when a selector rots — so a silent break becomes a visible, fixable one.

### Resilience

Selectors run most-specific first, then generic **visible-element** fallbacks (a stray hidden composer is skipped), then the clipboard fallback. One renamed id no longer takes a site down.

---

## 4. Transcript & metadata

For destinations that can't watch the video, TL;DW extracts the transcript by intercepting YouTube's own InnerTube/`timedtext` network responses (survives DOM redesigns), with a rendered-panel DOM scrape as fallback. Duration + channel are read for the worth-watching gate (`<video>.duration`, falling back to the `.ytp-time-duration` label).

---

## 5. Roadmap

### Shipped core

- [x] Keyboard shortcut, popup, and right-click menu on YouTube watch pages and Shorts
- [x] URL capture + prompt built from editable profiles
- [x] Auto-inject + auto-submit, with graceful clipboard fallback
- [x] Local prompt history (delete, clear, copy-prompt, re-ask), built-in + custom profiles, default profile, auto-submit toggle, history limit

### Shipped — multi-destination & transcript era

- [x] Multiple destinations (Gemini, ChatGPT, Claude, NotebookLM) with per-session override
- [x] Transcript extraction (network interception + DOM fallback) appended for non-Gemini chats
- [x] NotebookLM automation (drive the "Websites" source with the video link)
- [x] Worth-watching verdict gate for long videos, with a trusted-channel bypass
- [x] Auto-pause the video on summarize
- [x] Open-search "jump back" + failure surfacing in the popup (badge + alert)
- [x] Selector resilience (visibility-filtered matching, broadened fallbacks)
- [x] Per-destination CTA verb ("Add to NotebookLM" vs "Ask ChatGPT")
- [x] History hygiene — store a transcript-free prompt, opt-out auto-expiry
  (7/30/90/365 days), history settings live on the History page

### Shipped — Direct API, sponsors, stats & tags era

- [x] **Direct API mode** — headless Gemini REST call on navigation, verdict +
  summary rendered in an on-page widget, no destination tab opened; daily quota
  bar (~500 RPD free tier) and a metadata-only-by-default call log
  (`DirectApiSection.tsx`, `background/index.ts`)
- [x] **SponsorBlock auto-skip** — skip in-video sponsor segments from the free
  community data, with inline timestamps + Undo and lifetime seconds-saved
  (`content/sponsorblock.ts`, `sponsor.ajay.app`)
- [x] **Watch-time engine** — auto-rated each video Engaged / Skimmed / Skipped and
  rolled up per-channel averages (`content/watchtime.ts`, `lib/engagement.ts`).
  **Re-scope 2026-06-25:** this and its dashboards were **pulled out of the UI**
  (heading to the Watchprint companion extension); the engine still runs under the
  hood pending removal.
- [x] **Stats dashboard (summary-centric)** — # summaries created, cache hits,
  summarized-today, top channels by # summaries, profile usage, destination usage,
  most-used tags, and a GitHub-style **summary-activity heatmap + streak**
  (`StatsSection.tsx`). The F7 Phase 1 week/month/year/all-time **engagement**
  rollups + finish-rate donut (`lib/dashboards.ts`) were **removed from the UI** in
  the re-scope (logic retained, headed for Watchprint).
- [x] **Channels + per-channel tags** — channel cards, an auto-summarize list,
  and a tags layer (channel ∪ video tags) surfaced on the widget and the
  options Tags page (`ChannelsSection.tsx`, `TagsSection.tsx`, `lib/storage.ts`).
  Channel tags are keyed by channel **name** (was channel id).
- [x] Summary-panel polish — overflow (kebab) menu, channel-average cue,
  fill-on-hover pills, force-rerun Regenerate. These controls live on the
  rendered summary panel; the summary itself is now triggered by an inline
  "TL;DW" button in the subscribe row (the always-on idle box and the loading
  skeleton panel were removed) (`content/youtube.ts`)

### Declined

- Reuse an open destination tab instead of opening a new one
- "Summarize up to where I am" (trim transcript to the player's `currentTime`)

### Next — the real depth

The F1–F8 feature sprint (overflow menu, engagement-cue redesign, watch-%
persistence, prose tightening, per-channel tags) and F7 Phase 1 (time-windowed
dashboards) shipped via PRs #1 and #2; the original backlog and the parallelized
2-agent / worktree plan are archived under
**[docs/archive/](docs/archive/)**. The genuinely open thread now is the
**analytics split**: the watch-time + engagement analytics are moving to the
**Watchprint** companion extension (`../watchprint`, local-only, free), leaving
TL;DW as the summarizer with summary-scoped stats — see
[`docs/ANALYTICS_SPLIT.md`](docs/ANALYTICS_SPLIT.md). (F7 Phase 2 "paid / hosted
analytics" is **dropped** — Watchprint is free; the "don't charge for local data"
reasoning is in `docs/archive/F7_PHASE1_PLAN.md` §0.) The seek-links / key-moments
line items that used to sit here were cut — that feature was removed and
`SEEK_LINKS.md` deleted (see commit 600e7e4) — and the two follow-ups below have
since shipped:

- [x] Import / export profiles as JSON (validation, name-conflict "Copy") —
  `options/sections/ProfilesSection.tsx`
- [x] Per-search curiosity field in the popup — `popup/App.tsx` wires
  `userCuriosity` into the prompt

---

## 6. Permissions

Current (`manifest.config.ts`):

- `storage` — profiles, settings, history, and the session-scoped prompt handoff / open-searches / delivery-status
- `tabs` — open destinations + read the active tab URL
- `contextMenus` — the right-click entry
- `clipboardWrite` — the auto-fill-failed clipboard fallback (runs without a user gesture, so the permission is required)
- host permissions for `youtube.com` and each destination site (the injection content scripts), plus `generativelanguage.googleapis.com` (the Direct API Gemini REST call) and `sponsor.ajay.app` (SponsorBlock segment lookups)

`commands` is declared via the manifest `commands` key (the shortcut), not a permission.

---

## 7. Privacy

- All persistent data is local (`chrome.storage.local`); session state (handoff, open searches, delivery status) is `chrome.storage.session`. No backend, no account, no analytics.
- We log the **prompt + URL + timestamp** at the moment of firing — a
  transcript-free prompt, so transcripts are sent to the AI but never stored.
- Old history auto-expires (30 days by default, configurable/off) so it can't
  grow unbounded toward the `storage.local` quota.
- We **never** read or store the model's response.

---

## 8. Tech stack

- Manifest V3 (service-worker background, content scripts in isolated + MAIN world)
- TypeScript + Vite + `@crxjs/vite-plugin`
- React for popup / options; vanilla TS for the content scripts
- `chrome.storage.local` for data, `chrome.storage.session` for ephemeral state
- Vitest for unit tests on the pure helpers (`npm test`)
