# TL;DW — Product Plan

> **TL;DW = "Too Long; Didn't Watch."**
>
> **Thesis:** A Chrome extension that turns "I want to ask an AI about this YouTube video" into a single keystroke.
>
> **Core promise:** It saves the *search*, not the *answer*. That keeps the extension simple, private, fast, and buildable.

> _Refreshed 2026-06-06 to match the shipped product. The original plan was Gemini-only;
> TL;DW now sends to several destinations and extracts the transcript. History below
> is preserved where still accurate._

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
| **ChatGPT / Claude / Perplexity** | inject + submit | prompt **with the transcript appended** (they can't watch the video) |
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

- [x] Multiple destinations (Gemini, ChatGPT, Claude, Perplexity, NotebookLM) with per-session override
- [x] Transcript extraction (network interception + DOM fallback) appended for non-Gemini chats
- [x] NotebookLM automation (drive the "Websites" source with the video link)
- [x] Worth-watching verdict gate for long videos, with a trusted-channel bypass
- [x] Auto-pause the video on summarize
- [x] Open-search "jump back" + failure surfacing in the popup (badge + alert)
- [x] Selector resilience (visibility-filtered matching, broadened fallbacks)
- [x] Per-destination CTA verb ("Add to NotebookLM" vs "Ask ChatGPT")

### Declined

- Reuse an open destination tab instead of opening a new one
- "Summarize up to where I am" (trim transcript to the player's `currentTime`)

### Next — the real depth

- [x] **Clickable seek links (v1)** — on-page key-moments panel derived from the
  timestamped transcript, click-to-seek (see SEEK_LINKS.md; markers + smarter
  sources still to come)
- [ ] Import / export profiles as JSON (validation, name-conflict "Copy")

---

## 6. Permissions

Current (`manifest.config.ts`):

- `storage` — profiles, settings, history, and the session-scoped prompt handoff / open-searches / delivery-status
- `tabs` — open destinations + read the active tab URL
- `contextMenus` — the right-click entry
- `clipboardWrite` — the auto-fill-failed clipboard fallback (runs without a user gesture, so the permission is required)
- host permissions for `youtube.com` and each destination site (the injection content scripts)

`commands` is declared via the manifest `commands` key (the shortcut), not a permission.

---

## 7. Privacy

- All persistent data is local (`chrome.storage.local`); session state (handoff, open searches, delivery status) is `chrome.storage.session`. No backend, no account, no analytics.
- We log the **prompt + URL + timestamp** at the moment of firing.
- We **never** read or store the model's response.

---

## 8. Tech stack

- Manifest V3 (service-worker background, content scripts in isolated + MAIN world)
- TypeScript + Vite + `@crxjs/vite-plugin`
- React for popup / options; vanilla TS for the content scripts
- `chrome.storage.local` for data, `chrome.storage.session` for ephemeral state
