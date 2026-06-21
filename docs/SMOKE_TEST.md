# TL;DW — Manual Smoke Test

_Everything below is verified **statically** (typecheck + 101 unit tests + build +
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

- [ ] Open a normal YouTube **watch** page → the **TL;DW panel** injects below the
      player (verdict pill + one-line summary).
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
      B gets its own (or its idle panel). Go back to A → A still shows A's summary
      (its cache wasn't overwritten by B).
- [ ] 🔴 Repeat with the **tab-flow** (no key): same result.

### B2 — Direct-API error surfaces (no 90s hang)
- [ ] 🔴 Temporarily break the key (Options → Direct API → bad key), summarize a video.
      **Expected:** within a few seconds the panel shows an **error + retry**, not a
      90-second spinning skeleton, and the toolbar badge is **not** a green ✓.
      Restore the key after.

### B3 — Parser / RATING revived
- [ ] 🔴 A normal Direct-API summary parses cleanly (verdict + one-sentence summary +
      details), even when the model bolds labels.
- [ ] 🔴 The **AI cue** shows on a channel you've summarized before — a "📊 vs channel"
      row with a ▲/▼/≈ marker (this was dead before — the prompt now asks for RATING).

### B4 — Prose has no filler (F5)
- [ ] 🔴 Summary + details **state the substance directly** — no "The video provides a
      masterclass in…", "This video covers/highlights/discusses…". They read like the
      claim itself.

### B5 — Watch-tracking persists across refresh
- [ ] 🔴 Watch ~40% of a video, **refresh** the page. The background engagement
      tracking resumes (it no longer resets to 0). Easiest check: the per-channel
      **average** the panel shows stays consistent, and the engagement verdict for
      that video doesn't flip to "Skipped" after a refresh.

### B6 — Multi-tab watch-time (storage race)
- [ ] 🔴 Play **two** YouTube videos in two tabs for a minute. Then **Options → Stats**:
      watch/engagement counters reflect both (no obvious double-count or undercount;
      they don't go backwards).

### B7 — Popup doesn't revert your choices (F2/#18)
- [ ] 🔴 In the popup: pick **ChatGPT**, then tick **⚡ Direct API**. **Expected:** the
      destination stays ChatGPT and your worth-watching toggle isn't cleared (before,
      it snapped back to Gemini).

### B8 — History page doesn't wipe entries (#5)
- [ ] 🔴 With **Options → History** open and a video playing/summarizing in another tab,
      change a history setting (the limit, or delete one entry). **Expected:** entries
      the background added stay; nothing gets silently wiped.

### B9 — Settings inputs (#29/#31)
- [ ] 🟡 Options → Settings → Engagement: clear the "Engaged %" field and retype — it
      doesn't snap to the minimum mid-edit. The "Trusted channels" textarea types
      smoothly (no per-keystroke lag).

### B10 — mobile is out of scope
- [ ] 🟢 Open a video on **m.youtube.com** (mobile) → TL;DW does **not** run there.
      Mobile support was dropped (desktop-only selectors); `m.youtube.com` is no
      longer in the manifest. This is expected, not a bug.

---

## C. Feature sprint (🟡 tags / engagement / menu / regenerate)

### C1 — ⋯ overflow menu + fill-hover (F1/F4)
- [ ] 🟡 The summary header shows verdict + summary + **Auto-summarize** + **Skip
      channel** inline, and a **"⋯"** button.
- [ ] 🟡 Clicking "⋯" opens a menu with **Clear cache**, **⚡ Gemini/source**, **Open
      tab**. Closes on outside-click and **Esc**.
- [ ] 🟡 Hover **Auto-summarize** → it **fills blue with white text** (not just a border).
      Skip-channel fills red. Looks consistent in **light and dark** YouTube themes.

### C2 — Engagement cue is average-only (F2)
- [ ] 🟡 On a fresh load, the engagement line shows your **channel average** (e.g.
      "you usually skim this channel") **if you have history** — and **never "0%
      watched"**. With no history for the channel, it shows nothing.

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

---

## D. F7 Phase-1 dashboards (🟡 Options → Stats)

- [ ] 🟡 A **[This week | This month | This year | All-time]** toggle appears at the top.
- [ ] 🟡 **All-time** looks exactly like before (unchanged layout).
- [ ] 🟡 **This week** leads with **"Time TL;DW gave back this week"** + a **▲/▼ vs last
      week** delta chip.
- [ ] 🟡 **Finish rate** donut is windowed and shows a **pts vs last** delta.
- [ ] 🟡 **"What you watched"** lists top channels for the window with their engagement mix.
- [ ] 🟡 **Active days** ("5 / 7"), **hours previewed**, **channels** tiles render.
- [ ] 🔴 **Block nudge:** if you skip ≥70% of a channel (≥5 videos) in the window, a
      "You skipped X of Y from <channel> — Block it?" card appears. Click **Block
      channel** → go to a **watch page** for that channel → **the TL;DW panel is
      suppressed** (the nudge actually blocks). Reload Stats → the nudge for that
      already-blocked channel does **not** come back.
- [ ] 🟢 **This year** shows the "based on retained history" footnote.
- [ ] 🟢 Channel **avatars** render; an expired/broken avatar URL falls back to a plain
      circle (no broken-image glyph).
- [ ] 🟢 A brand-new / empty window shows a friendly "nothing this week yet" — no NaN /
      broken layout.

---

## E. SponsorBlock + existing flows (🟢 regression guard)

- [ ] 🟢 On a video with sponsor segments: it **auto-skips**, the inline SponsorBlock
      widget shows the segments with **Undo**, and skipping doesn't get counted as watch
      time (engagement % stays sane).
- [ ] 🟢 **Tab-flow** end-to-end (no key): popup → "Ask ChatGPT" (or Claude) → the tab
      opens, the prompt auto-fills + submits, and the answer is read back onto the
      YouTube panel. A composer it can't fill falls back to copying the prompt (toast).
- [ ] 🟢 Right-click a video / thumbnail → "Send to <destination> with…" menu works.
- [ ] 🟢 **Alt+Shift+G** keyboard shortcut triggers a summary.

---

## F. If something's wrong

- Capture the **DevTools console** on the YouTube tab (content-script logs are
  prefixed `[TL;DW]`, watch-time `[TL;DW WT]`, sponsor `[TL;DW SB]`).
- The **popup** surfaces auto-fill failures (a red "last send didn't work" with the
  site + reason) and gate notices — note those.
- For background/worker errors: `chrome://extensions` → TL;DW → **service worker** →
  Inspect → Console.
- Note **which path** (Direct API vs tab-flow) and **which video/channel**, and paste
  it back here — I'll fix it.

---

### Priority if you're short on time
Do the 🔴 items in **B** (navigate-during-summary, error surfacing, RATING cue,
watch persistence, multi-tab stats, popup choices, history-no-wipe), then **C3**
(tags seam) and **D**'s block-nudge. Those are the subtle, this-session changes most
worth a human eye.
