# TL;DW — Manual Verification Checklist (this session)

_Everything in this session is verified **statically** (typecheck + unit tests +
build + reviews) but **not** in a real browser. This is the in-Chrome pass that
closes that gap. Load the unpacked extension, walk it, check the boxes as you go.
Each step is `action → expected result` and is grounded in the actual code._

**Legend:** 🔴 high-risk (the subtle/new bits — test first) · 🟡 feature path ·
🟢 nice-to-have.

> ### ⚠ Watch closely (the 3 most likely to be visibly broken)
> 1. 🔴 **Virtualized scroll** — Channels (both tabs), History, and the expanded
>    channel's video list now render only the rows near the viewport. Scroll fast
>    and watch for: rows **overlapping / jumping / blanking**, a wrong scrollbar
>    height, or the page **not scrolling at all**. Expand→collapse must still
>    animate; search/sort must still apply across the **whole** list, not just the
>    ~20 visible rows.
> 2. 🔴 **Inline button stuck on "Analyzing…"** — the button IS the loading
>    indicator now (no skeleton panel). It must always return to "TL;DW" or a
>    summary on every outcome: success, error, timeout, **and SPA-navigation away
>    mid-run**. If it ever sits on "Analyzing…" forever, that's the bug.
> 3. 🔴 **Nested video-list scroll** — inside an expanded channel card there's a
>    bounded (max-height 320px) windowed list scrolling *inside* the outer
>    windowed channel list. Scroll the inner list, then the outer — neither should
>    fight the other, hijack the wheel, or mis-measure the card height.

---

## 0. Setup

- [ ] `npm run build`, then `chrome://extensions` → **Reload** the unpacked TL;DW.
- [ ] Confirm the version near the **sidebar logo** (Options) matches the build.
- [ ] Open DevTools console on a YouTube watch tab to catch `[TL;DW]` errors.
- [ ] Note your path: with a Gemini key + "Use Direct API" on you're on the
      **headless** path; without, the inline button/auto-summarize run the
      **tab-flow** (opens a destination tab and reads the answer back). Behavior of
      the *button states* is the same either way.

---

## A. On-page widget (the inline TL;DW button)  🔴

> Source: `src/content/youtube.ts`. The always-on idle "Get Summary" box is GONE.
> A single **"TL;DW"** button is mounted in the owner/subscribe row.

### A1 — Button placement & idle state
- [ ] 🔴 Open a normal **watch** page → a blue **"TL;DW"** pill appears in the
      subscribe row, **right of Subscribe** (and next to vidIQ's button if present).
      No panel appears below the player yet (cold video = no auto panel).
- [ ] 🟡 Hover the button → it darkens (blue → deeper blue). Tooltip reads
      "Summarize this video with TL;DW".
- [ ] 🟢 The button is roughly the **same height as Subscribe** (~36px) and aligns
      on the row.

### A2 — Click → Analyzing → summary
- [ ] 🔴 Click **"TL;DW"** → it immediately flips to **"Analyzing…"** (dimmed,
      gentle shimmer pulse) → within a few seconds the **summary panel** appears
      below the player and the button returns to **"TL;DW"** (tooltip now
      "Summary ready — click to jump to it").
- [ ] 🔴 With a summary already shown, click the button again → it **scrolls to the
      panel**, it does NOT re-run.
- [ ] 🔴 **Double-click** the button fast on a cold video → only **one** run starts
      (no duplicate panel / double API call). The 2nd click is swallowed while
      `runInFlight`.

### A3 — Loading lives in the button (no skeleton)  🔴
- [ ] 🔴 While "Analyzing…" shows, confirm there is **no skeleton/placeholder
      panel** below the player — the button is the only loading cue.
- [ ] 🔴 **Error path:** break the Gemini key (Options → Direct API → bad key) and
      click TL;DW. **Expected:** the button drops "Analyzing…" back to "TL;DW", and
      an **error panel with "↻ Try again"** appears below. Click **Try again** →
      it re-runs (restore the key first to see it succeed). The button must **not**
      stay stuck on "Analyzing…".
- [ ] 🔴 **Timeout path (tab-flow):** with no key, click TL;DW and abandon the
      destination tab (don't sign in / close it). After the grace period the
      button un-sticks and the error panel appears with the tab-flow message +
      retry. (This is generous — ~90s; you can trust the earlier error-path check
      and just confirm it doesn't hang *forever*.)
- [ ] 🔴 **Navigate mid-run:** click TL;DW, then immediately click a suggested
      video (same tab) before it finishes. **Expected:** the new video's button
      starts at **"TL;DW"** (idle), NOT "Analyzing…" — the old run's state doesn't
      leak onto the new video. The old summary never appears on the new video.

### A4 — Auto-show paths still work
- [ ] 🟡 **Cached video:** summarize a video, then reload it (or revisit) →
      the panel **auto-appears from cache** (source "cached"), no click needed, and
      the button reads "TL;DW" / "Summary ready".
- [ ] 🟡 **Auto-summarize channel:** turn on Auto-summarize for a channel (panel
      header toggle, or Options → Channels), open a fresh video from it →
      the button flips to "Analyzing…" on its own and the summary auto-appears.

### A5 — Live-stream suppression
- [ ] 🔴 Open an **in-progress live stream** (red LIVE badge, no transcript) →
      **no TL;DW button** and **no panel** (`watchButtonAllowed` is false). A
      **finished/recorded** live stream (has a transcript) **does** get the button.

### A6 — "Block channel" is GONE  🔴
- [ ] 🔴 Open the panel's **"⋯"** overflow menu → there is **no "Block channel"**
      item (it should only offer Clear cache / source / Open tab actions).
- [ ] 🔴 The panel header has **Auto-summarize** but **no "Skip/Block channel"**
      pill.

---

## B. Popup

> Source: `src/popup/App.tsx`, `src/popup/popup.css`. Open the toolbar popup on a
> YouTube video.

- [ ] 🟡 **First-run notice** (fresh profile / before dismissing): it's a single
      **short one-line** note ("Auto-skips sponsors… rates videos from your local
      watch-time — all on-device. Settings"). **Click anywhere on it → it
      dismisses** (and stays gone). The inline "Settings" link opens Options
      without bubbling a second action.
- [ ] 🔴 **4 destination buttons**, evenly spaced across the grid: **Gemini,
      ChatGPT, Claude, NotebookLM**. **Perplexity is gone.** No empty 5th cell / no
      lopsided row.
- [ ] 🔴 **Claude icon** is a crisp inline SVG (clay-orange rounded square, white
      glyph) at ~26px — sharp, not a blurry/oversized PNG.
- [ ] 🟡 At the **bottom of the popup**, a **"☕ Buy me a Ko-fi"** link →
      opens `ko-fi.com/n8watkins` in a new tab.
- [ ] 🟢 The version still shows in the header (`v…` chip top-right).
- [ ] 🟢 Regression: picking a destination + ticking ⚡ Direct API doesn't snap your
      destination back to Gemini.

---

## C. Options — Channels  🔴

> Source: `src/options/sections/ChannelsSection.tsx`. Needs some watch history to
> populate. New users will see empty states — that's expected.

### C1 — Tabs
- [ ] 🟡 Two tabs at the top: **"All channels"** and **"Auto-summarize"**, each with
      a count. Switching tabs swaps the list.
- [ ] 🟡 **Switching tabs clears the search box** (type in search on All, switch to
      Auto-summarize → the box is empty, and vice-versa).

### C2 — Search (name AND tag)
- [ ] 🟡 On **All channels**, the search placeholder reads "Search channels by name
      or **tag**…". Type part of a **channel name** → list filters to matches.
- [ ] 🔴 Type part of a **tag label** you've assigned to a channel → the channel(s)
      carrying that tag show up (tag search actually works now — see C5).
- [ ] 🟡 The "X of N channels" counter updates with the filter; a no-match query
      shows "No channels match …" (not a blank list / dead end).
- [ ] 🟢 On **Auto-summarize**, search filters by channel **name** (search box only
      shows when there's more than one auto channel).

### C3 — Tag chips & contrast
- [ ] 🟡 A channel that has tags shows its **tag chips** on the card (small pills
      next to the verdict/engagement pills).
- [ ] 🔴 **Contrast fix:** the muted metadata — "6 days ago", "3 videos", the
      "Added …" line, "Sort:", the Auto-summarize label — looks **muted/grey**
      (`--muted` ≈ #94a3b8), NOT full-brightness white. (Before, these used an
      undefined `--text-muted` and rendered too bright.)

### C4 — Expand / collapse + nested video list  🔴
- [ ] 🔴 Click a channel card → it **expands** (smooth grid animation) to reveal its
      video list; click again → collapses. The chevron rotates.
- [ ] 🔴 In a channel with **many** watched videos, the expanded video list scrolls
      **inside the card** (bounded ~320px) and **windows** — scroll it, rows
      shouldn't overlap or blank out. Clicking a video title opens it in a new tab.
- [ ] 🟡 The **"Auto-summarize this channel"** checkbox at the bottom of the
      expanded card toggles the channel into/out of the Auto-summarize tab.

### C5 — Channel tags keyed by NAME
- [ ] 🔴 On a watch page, add a **channel tag** to a channel (panel tags row).
      Then in **Options → Channels → All**, that channel's card shows the chip AND
      searching its tag label surfaces it. (Tags are keyed by channel **name** now,
      lining up with the name-keyed Channels view — previously id-keyed tags never
      matched here.)

### C6 — Virtualized channel lists  🔴
- [ ] 🔴 With many channels, scroll the **All channels** list fast → smooth, no
      overlap/jump, scrollbar height reflects the full list, expand still works on
      rows scrolled into view.
- [ ] 🔴 Repeat on the **Auto-summarize** list.

---

## D. Options — Stats

> Source: `src/options/sections/StatsSection.tsx`. View the **All-time** tab.

- [ ] 🟡 A new **"Top channels by time spent"** card lists channels ranked by watch
      time, each row "Xm · N videos".
- [ ] 🟡 A new **"Most engaged channels"** card lists channels by engaged count,
      "N engaged · P%".
- [ ] 🔴 The **"Top channel"** small tile now reflects **time spent** — its subline
      reads "Xm watched" (not "N videos"). The named channel should match the top
      of the "Top channels by time spent" card.
- [ ] 🟢 **New user / no watch time:** both new cards show friendly empty states
      ("No watch time tracked per channel yet." / "No engaged videos tracked per
      channel yet."), and the Top-channel tile shows "—" / "no data yet" — no NaN
      or broken layout.
- [ ] 🟢 The week/month/year windowed views still render (regression guard).

---

## E. Options — Support + About

> Source: `src/options/sections/SupportSection.tsx`, `AboutSection.tsx`.

### E1 — Support ("Support the dev")
- [ ] 🟡 The section title is **"Support the dev"**. Cards present, each opening in a
      new tab:
  - [ ] **Buy me a Ko-fi** → `ko-fi.com/n8watkins`
  - [ ] **n8builds.dev** → `n8builds.dev`
  - [ ] **Hire me — Appturnity** → `appturnity.com`
  - [ ] **GitHub repo** and **Report an issue** (existing).
- [ ] 🔴 **No version number** anywhere on the Support page (it moved to the sidebar
      logo + About).

### E2 — About
- [ ] 🟡 The destinations card title reads **"4 AI destinations"** (not 5), and
      lists exactly **Gemini, ChatGPT, Claude, NotebookLM** with their icons.
- [ ] 🔴 The **Claude chip icon** is the inline SVG and looks the same as in the
      popup (consistent at small size).
- [ ] 🟢 The **version chip** appears in the About hero (`v…`).

### E3 — Sidebar version
- [ ] 🟡 The Options **sidebar logo** shows a `v…` pill right of "TL;DW".

---

## F. History (virtualized)  🔴

> Source: `src/options/sections/HistorySection.tsx`.

- [ ] 🔴 With many history entries, scroll the list fast → smooth windowing, no
      overlap/jump/blank rows, scrollbar reflects the full count.
- [ ] 🔴 Expand an entry (click a row) → the **prompt / API response** detail
      reveals and animates; collapse works. Expanding one and scrolling shouldn't
      mis-measure or shift other rows.
- [ ] 🟡 **Search** ("by video, profile, or prompt text") filters across the
      **whole** history (not just visible rows); the "X of N entries" count updates.
- [ ] 🟡 Per-row **Open / Copy prompt / Delete** still work; Clear All still works.
- [ ] 🟢 Regression: with History open and a video summarizing in another tab,
      background-added entries are not silently wiped.

---

## G. If something's wrong

- Capture the **DevTools console** on the YouTube tab (`[TL;DW]` logs) and, for the
  worker, `chrome://extensions` → TL;DW → **service worker** → Inspect.
- For a stuck button, note: which path (Direct API vs tab-flow), what you clicked,
  and whether navigating away cleared it.
- For virtualized lists, note the surface (Channels All / Auto / History / expanded
  video list), roughly how many rows, and what broke (overlap / blank / no-scroll).

### Priority if short on time
The 🔴 **Watch closely** trio up top: virtualized scroll (A-none, but **C6 / F /
C4**), the **inline button stuck-state** (A2/A3), and the **nested video-list
scroll** (C4). Then the removals — **Block channel gone** (A6), **Perplexity gone /
4 destinations** (B, E2), and the **Stats time-spent** rework (D).
