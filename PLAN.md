# TL;DW — Product Plan

> **TL;DW = "Too Long; Didn't Watch."**
>
> **Thesis:** A Chrome extension that turns "I want to ask Gemini about this YouTube video" into a single keystroke.
>
> **Core promise:** It saves the *search*, not the *answer*. That keeps the extension simple, private, fast, and buildable.

---

## 1. The spine, in one sentence

On a YouTube tab, press **Alt+G** → grab the URL → build the default prompt → open a new Gemini chat → auto-fill the composer → press Enter. The user reads the answer instead of watching the whole video.

That single motion *is* the product. Everything else is management UI layered on top.

---

## 2. How the motion works (4 pieces)

| # | Piece | Responsibility |
|---|-------|----------------|
| 1 | **Shortcut** | `chrome.commands` registers Alt+G by default |
| 2 | **YouTube side** | Read the active tab's URL (title/channel optional — see §4) |
| 3 | **Handoff** | Build prompt, stash it keyed by tab id, open `gemini.google.com/app` |
| 4 | **Gemini side** | Content script on Gemini waits for the composer, injects the prompt, submits |

**Piece #4 is the whole ballgame.** See §3.

### Handoff detail (avoid the multi-tab race)

If the user fires the shortcut twice quickly, two Gemini tabs open and each must pick up *its own* prompt.

1. Background opens the Gemini tab and gets the new `tabId`.
2. Background stores `pending[tabId] = prompt` in `chrome.storage.session`.
3. The Gemini content script reads the prompt for *its own* tab id, injects it, then clears that key.

Cheap to design in now; painful to retrofit.

---

## 3. The #1 risk: auto-injecting into Gemini

We are **assuming** Gemini ingests a video from its URL. Given that, the existential risk is no longer "can Gemini watch videos" — it's:

> **Can we reliably inject text into Gemini's composer and trigger send?**

Gemini's input is a **contenteditable rich-text div, not a plain `<textarea>`**. Consequences:

- Setting `.value` does nothing. We must simulate input (`InputEvent` / synthetic paste) so Gemini's framework registers the text and **enables** the send button.
- The send trigger is a synthetic Enter keypress or a click on the send button — and that button stays disabled until input is detected.
- Gemini's DOM/class names change without notice, so our selectors **will** break periodically.

This is the classic "works in the demo, silently breaks in 3 months" feature. Therefore:

### Non-negotiable V1 rule: graceful fallback

> If injection fails, **copy the prompt to clipboard** and leave the Gemini tab open with a small toast: *"Prompt copied — paste to send."*
> Never leave the user staring at an empty Gemini box wondering what happened.

The fallback is a **V1 feature**, not a nice-to-have.

### Current handling

The extension now attempts composer injection and auto-submit first. If that fails, it copies the prompt and shows a Gemini-page toast so the user can paste manually.

---

## 4. A free simplification

If the prompt is just *"Summarize this video: {{url}}"* and Gemini ingests the link, we **may not need the title or channel at all.**

That deletes the most fragile part of YouTube-side scraping (SPA selectors that rot on every YouTube redesign).

**Start URL-only.** Add title/channel later *only if* it measurably improves output.

---

## 5. Roadmap

### Shipped core

Goal: the Alt+G motion works end-to-end, reliably, with a sane fallback.

- [x] Keyboard shortcut on YouTube watch pages and Shorts
- [x] URL capture from the active tab
- [x] Prompt built from editable profiles
- [x] Open Gemini in a new tab
- [x] Auto-inject + auto-submit into Gemini's composer
- [x] Graceful fallback: injection fails → copy prompt + toast, tab still opens
- [x] Popup entry point with profile selection
- [x] Local prompt history with delete and clear
- [x] Built-in editable profiles
- [x] Set default profile
- [x] Auto-submit toggle in settings
- [x] Toolbar context menu for choosing a profile
- [x] History limit setting
- [x] Clear empty state when the active tab is not a YouTube video

That's a genuinely complete, useful product.

### Next management & polish

- [ ] Title + channel extraction with SPA `yt-navigate-finish` handling — *if* it improves results
- [ ] Profile duplicate / archive
- [ ] Reset defaults (all at once; per-profile + `isCustomized` tracking deferred further)
- [ ] History dashboard: search, profile filter, sort, copy-prompt, reopen-video
- [ ] Remaining settings (`includeMetadataHeader`, custom Gemini URL, etc.)

### V1.2 — sharing / portability

- [ ] Import / export profiles as JSON (+ validation, name-conflict "Copy", plain-text safety guard)

> These add real surface area (validation, XSS guard) for a feature most users touch once. Defer cleanly.

### V2+ — the real depth

- Transcript extraction, timestamp-aware prompts, scoring rubrics
- Gemini API mode (BYO key, run inside extension, optionally save responses)
- Profile packs / shareable links / sync

---

## 6. Permissions (shrunk for this design)

Likely sufficient:

- `commands` — the shortcut
- `storage` — profiles, settings, history, pending-prompt handoff
- `tabs` — open Gemini + read active tab URL
- **host permissions** for both `youtube.com` *and* `gemini.google.com` (the latter is new and required for the injection content script)

Probably **droppable**: `scripting`, `activeTab`, `clipboardWrite` — if content scripts are declared statically and clipboard is used from the right context.

Fewer permissions = the privacy pitch stays clean and Web Store review is faster.

---

## 7. Privacy

- All data local (`chrome.storage.local`). No backend, no account, no analytics.
- We log the **prompt + URL + timestamp** at the moment of firing.
- We **never** read or store the Gemini response. Auto-submit does not change this.

---

## 8. Tech stack

- Manifest V3
- TypeScript + Vite
- React + Tailwind for popup / options (vanilla is fine for the content scripts)
- `chrome.storage.local` for data, `chrome.storage.session` for the prompt handoff

---

## 9. Open question

- **Profile choice via keyboard?** Today: the shortcut uses the *default* profile silently; profile choice happens in the popup. Add a second shortcut / quick-picker only if there's real demand.

---

## 10. Suggested first session

1. Spike piece #4 (Gemini composer injection + submit) as a standalone content script. Measure reliability.
2. If solid → scaffold the V1 spine around it.
3. If flaky → harden the fallback first, treat auto-submit as best-effort.
