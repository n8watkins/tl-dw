# TL;DW — Manual Smoke Test

_Everything below is verified **statically** (typecheck + 49 unit tests + build +
multiple adversarial reviews) but **not** in a real browser. This is the in-Chrome
pass that closes that gap. Walk it after a build; check the boxes as you go._

**Legend:** 🔴 high-risk (subtle fixes from this session — test these first) · 🟡
feature path · 🟢 nice-to-have.

---

## 0. Setup

- [ ] `npm run build` (bumps the version, builds `dist/`, copies to the Windows folder).
- [ ] `chrome://extensions` → **Reload** the unpacked TL;DW extension.
- [ ] Confirm the popup's version number matches the build you just made.
- [ ] (For Direct-API paths) **Options → Direct API**: a Gemini API key is set and
      "Use Direct API" is on. Without a key you'll test the **tab-flow** instead
      (opens ChatGPT/Claude/etc.) — note which path you're on for each item.
- [ ] Open DevTools console on a YouTube tab to catch any `[TL;DW]` errors as you go.

---

## A. 5-minute core smoke (do this first)

- [ ] Open a normal YouTube **watch** page → an inline **"TL;DW" button** appears in
      the subscribe/owner row. Click it → the button shows **"Analyzing…"**, then a
      **summary panel** appears (one-line summary + details — **no** verdict pill).
- [ ] Click the panel → **details** expand/collapse.
- [ ] Open the toolbar **popup** on a video → it shows the video title + destination
      buttons + a profile select.
- [ ] Open a **Short** → only Gemini is offered (Shorts have no transcript).
- [ ] **Options page** opens (gear icon) and every left-nav section renders: Setup,
      Stats, Profiles, History, Channels, **Tags**, Settings, Direct API, Support, About.
- [ ] No red errors in the console during the above.

---

## B. Correctness fixes (🔴 the subtle ones — most important)

### B1 — Navigate-during-summary (the wrong-video / cache-poison fix)
- [ ] 🔴 Start a summary on **video A**, then immediately click a suggested **video B**
      (same tab) before A finishes. **Expected:** A's summary never appears on B;
      B gets its own (or its inline "TL;DW" button). Go back to A → A still shows A's
      summary (its cache wasn't overwritten by B).
- [ ] 🔴 Repeat with the **tab-flow** (no key): same result.

### B2 — Direct-API error surfaces (no 90s hang)
- [ ] 🔴 Temporarily break the key (Options → Direct API → bad key), summarize a video.
      **Expected:** within a few seconds the inline button drops "Analyzing…" and an
      **error panel** shows (**error + retry**) — it does **not** hang for 90 seconds,
      and the toolbar badge is **not** a green ✓. Restore the key after.

### B3 — Parser
- [ ] 🔴 A normal Direct-API summary parses cleanly (one-sentence **SUMMARY** +
      **DETAILS**), even when the model bolds labels. The prompt requests only
      SUMMARY/DETAILS; the parser still tolerates a stray legacy VERDICT/RATING label
      without bleeding it into the summary text.
- [ ] 🔴 **No verdict pill, no AI rating, and no "📊 vs channel" engagement cue** appear
      on the panel — those were removed in the 2026-06-25 re-scope (the watch/engagement
      readout moved to the Watchprint companion extension). The summary panel shows the
      **summary + details only**.

### B4 — Prose has no filler (F5)
- [ ] 🔴 Summary + details **state the substance directly** — no "The video provides a
      masterclass in…", "This video covers/highlights/discusses…". They read like the
      claim itself.

### B5 — No watch-time tracking (engine deleted)
- [ ] 🟢 The watch-time engine and its data-layer modules were **deleted** — TL;DW no
      longer tracks watch-time or engagement. Optional dev check: with DevTools open on
      the YouTube tab, there are **no** `[TL;DW WT]` logs as you watch, and no engagement
      verdict, per-channel average, or "% watched" renders anywhere. (That analytics now
      lives in the Watchprint companion extension.)

### B6 — Popup doesn't revert your choices (F2/#18)
- [ ] 🔴 In the popup: pick **ChatGPT**, then tick **⚡ Direct API**. **Expected:** the
      destination stays ChatGPT and your other choices aren't cleared (before, it
      snapped back to Gemini).

### B7 — History page doesn't wipe entries (#5)
- [ ] 🔴 With **Options → History** open and a video playing/summarizing in another tab,
      change a history setting (the limit, or delete one entry). **Expected:** entries
      the background added stay; nothing gets silently wiped.

### B8 — Settings inputs
- [ ] 🟡 Options → Settings shows the surviving groups only — **Behavior** (auto-submit,
      switch-to-tab, pause-on-summarize), **Playback** (auto-skip sponsored segments),
      **Summary cache**, **Privacy**, **Auto TL;DW** (the over-N-minutes auto-summarize
      select), **Default destination**, and **Reset**. There is **no** Engagement group
      anymore (no "Engaged %" field, no "Trusted channels" list) — those left with the
      deleted watch-time engine. Toggling each setting persists across a page reload.

### B9 — mobile is out of scope
- [ ] 🟢 Open a video on **m.youtube.com** (mobile) → TL;DW does **not** run there.
      Mobile support was dropped (desktop-only selectors); `m.youtube.com` is no
      longer in the manifest. This is expected, not a bug.

---

## C. Feature sprint (🟡 tags / menu / regenerate)

### C1 — ⋯ overflow menu + fill-hover (F1/F4)
- [ ] 🟡 The summary header shows the **summary** + **Auto-summarize** inline, and a
      **"⋯"** button (no verdict pill).
- [ ] 🟡 Clicking "⋯" opens a menu with **Clear cache**, **⚡ Gemini/source**, **Open
      tab**. Closes on outside-click and **Esc**.
- [ ] 🟡 Hover **Auto-summarize** → it **fills blue with white text** (not just a
      border). Looks consistent in **light and dark** YouTube themes.

### C2 — No engagement cue on the panel (re-scope)
- [ ] 🟡 The panel shows **no** engagement line ("you usually skim this channel" /
      "% watched" / "📊 vs channel"). That readout was removed in the 2026-06-25
      re-scope; it heads to the Watchprint companion extension. If it appears, the
      re-scope regressed.

### C3 — Tags (F6) — the headline feature + the cross-agent seam 🔴
- [ ] 🟡 The summary has a **"Tags:" row at the bottom**.
- [ ] 🟡 **Add a tag for this channel** (e.g. "Citations" → "Include the sources the
      video relies on"). It persists on the row as a chip.
- [ ] 🔴 **Regenerate / next video from that channel** → the summary/details now
      **reflect the tag** (e.g. mentions sources). _This is the Agent-A↔Agent-B seam —
      the most important feature check._
- [ ] 🟡 **Add a tag for this video only** (not the channel).
- [ ] 🟡 On a **video-only** tag's chip, use **"apply to all future"** (promote) → it
      moves to the channel and now auto-applies to that channel's videos.
- [ ] 🟡 **Remove** a tag chip → it's gone.
- [ ] 🟡 **"Edit tags →"** deep-links to **Options → Tags**, where you can create / edit
      / delete tags (label + prompt). Editing a tag's prompt changes future summaries.
- [ ] 🟡 Visit a **different channel** → its tags are independent (channel A's tags
      don't apply to channel B).

### C4 — Regenerate (F8)
- [ ] 🟡 Click **"↻ Regenerate"** → a **fresh** summary (cache bypassed), loading state
      then new result.
- [ ] 🟡 It **counts as a Gemini request** (the usage/call counter ticks up — check the
      popup or Options → Direct API).
- [ ] 🟡 After a regenerate that used a **video-only** tag, a **"save for this channel"**
      prompt appears; using it promotes the tag.

### C5 — Channels page (summary-centric; tabs + search + virtualized lists)
- [ ] 🟡 **Options → Channels** shows a **tab strip** (**All channels** / **Auto-summarize**)
      and a **search box**. Typing filters the list (All filters by name **or** tag;
      Auto-summarize filters by name); no matches shows a friendly empty state.
- [ ] 🟡 Each channel card is **summary-centric**: **# summaries · last summarized ·
      tags**. The sort is **Most summarized** / Recently summarized — there is **no**
      "most watched" / "highest rated" sort and **no** per-channel watch-time or
      engagement readout anymore (those left in the re-scope).
- [ ] 🟢 With many channels, the list is **virtualized** — it scrolls smoothly and rows
      render as you scroll (no lag, no broken layout).

---

## D. Summary-centric Stats (🟡 Options → Stats)

_The 2026-06-25 re-scope made Stats summary-centric. There is **no** engagement/
watch-time view here anymore — **no** week/month/year toggle, **no** finish-rate
donut, **no** "time given back", **no** watch-based heatmap. If you see any of those,
the re-scope regressed._

- [ ] 🟡 The page leads with summary counters: **Summaries created**, **cache hits**,
      and **summarized today**.
- [ ] 🟡 A **GitHub-style summary-activity heatmap** (year-long contribution grid,
      built from daily *summary* counts) renders, with a **streak** ("N-day streak").
      Summarizing a video today adds to today's cell.
- [ ] 🟡 **Top channels** lists your most-**summarized** channels (by # summaries),
      most-summarized first.
- [ ] 🟡 **Profile usage** shows a distribution of summaries by prompt profile
      (proportion bars).
- [ ] 🟡 **Destination usage** shows a distribution by destination (Direct API vs each
      open-in-a-tab AI).
- [ ] 🟡 **Most-used tags** lists your tags by assignment count.
- [ ] 🟢 Channel **avatars** render; an expired/broken avatar URL falls back to a plain
      circle (no broken-image glyph).
- [ ] 🟢 A brand-new / empty profile shows a friendly empty state — no NaN / broken
      layout — and the heatmap renders empty (no errors).

---

## E. SponsorBlock + existing flows (🟢 regression guard)

- [ ] 🟢 On a video with sponsor segments: it **auto-skips** and the inline SponsorBlock
      widget shows the segments with **Undo**. (SponsorBlock auto-skip is unchanged by
      the re-scope — only the watch/engagement *stats display* was removed.)
- [ ] 🟢 **Tab-flow** end-to-end (no key): popup → "Ask ChatGPT" (or Claude) → the tab
      opens, the prompt auto-fills + submits, and the answer is read back onto the
      YouTube panel. A composer it can't fill falls back to copying the prompt (toast).
- [ ] 🟢 Right-click a video / thumbnail → "Send to <destination> with…" menu works.
- [ ] 🟢 **Alt+Shift+G** keyboard shortcut triggers a summary.

---

## F. If something's wrong

- Capture the **DevTools console** on the YouTube tab (content-script logs are
  prefixed `[TL;DW]`, sponsor `[TL;DW SB]`). (There are no more `[TL;DW WT]` watch-time
  logs — that engine was deleted.)
- The **popup** surfaces auto-fill failures (a red "last send didn't work" with the
  site + reason) — note those.
- For background/worker errors: `chrome://extensions` → TL;DW → **service worker** →
  Inspect → Console.
- Note **which path** (Direct API vs tab-flow) and **which video/channel**, and paste
  it back here — I'll fix it.

---

### Priority if you're short on time
Do the 🔴 items in **B** (navigate-during-summary, error surfacing, parser, popup
choices, history-no-wipe), then **C3** (tags seam). Also sanity-check the re-scope:
**Stats is summary-centric** (section D — no engagement/donut/windowed view) and
**no engagement cue** shows on the panel or Channels page (B3 / C2 / C5).
