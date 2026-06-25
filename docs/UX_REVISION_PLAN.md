# TL;DW — UX Revision Plan

> Frontend audit + actionable plan for a batch of UX/feature changes. This is a
> **review document**, not an implementation. Every entry cites `file:line`
> against the tree at the time of writing, describes current behavior, proposes a
> change, and flags complications. Line numbers are approximate and will drift as
> the code changes — treat them as anchors, not contracts.

## Dev brand links (single source of truth for this doc)

| Purpose | URL | Confirm before shipping |
| --- | --- | --- |
| Ko-fi (tips) | `https://ko-fi.com/n8watkins` | ✅ confirmed |
| Personal site | `https://n8builds.dev` | ✅ confirmed (`n8builds.dev`, not "nate") |
| Consulting brand | Appturnity — `https://appturnity.com/` | ✅ confirmed |

Note: the codebase today points "Buy a coffee" at **buymeacoffee.com**, not Ko-fi
(`SupportSection.tsx:5`). Items 7, 14 standardize everything on the Ko-fi URL above.

---

## How theming works (read this before the contrast items)

- **Options page** is **dark-only**, driven by CSS custom properties on `:root`
  in `src/options/options.css:1-16` (`--bg`, `--surface`, `--border`, `--text`,
  `--muted`, `--faint`, `--danger`, `--success`). Applied globally at
  `options.css:45-46`. **No `data-theme`, no `prefers-color-scheme`, no light
  mode anywhere.** `OptionsApp.tsx` has zero theming logic.
- **Popup** (`popup.css`) is also dark-only but uses **hardcoded hex** (e.g.
  `#0f172a`, `#1e293b`, `#94a3b8`) — it does **not** use the options CSS
  variables. Self-consistent and fine for a dark-only popup; just be aware the
  two surfaces don't share tokens.
- **On-page widget** (`youtube.ts`) is theme-aware against **YouTube's** theme,
  not ours: `theme()` at `youtube.ts:696-701` reads
  `document.documentElement.hasAttribute("dark")` and returns a light or dark
  palette. This is correct and independent of the extension's own surfaces.

**Key correction to the brief's "black text on dark bg" assumption:** the
suspected contrast bug in Channels is **not** literally black-on-dark. It's a
**typo'd CSS variable**: `ChannelsSection.tsx` repeatedly uses
`color: "var(--text-muted)"`, but no `--text-muted` token exists — the defined
token is `--muted` (`options.css:11`). The undefined var falls back to inherited
`--text` (`#f1f5f9`), so "muted" metadata renders at **full brightness** instead
of muted. Legible, but wrong, and brittle. See item 10.

---

# A. On-page injected widget — `src/content/youtube.ts`

### A1. Remove the loading skeleton panel; make the inline button the sole loading state

- **Current:**
  - `showLoadingPanel()` (`youtube.ts:1286-1332`) injects a separate panel under
    the video that is just a header with an "Analyzing…" shimmer span
    (`:1301-1314`), sets `summaryPanelKind = "loading"`, and **also** calls
    `setWatchButtonState("analyzing")` (`:1319`). So the inline-button analyzing
    state **already exists** and already fires alongside the panel.
  - Callers of `showLoadingPanel()`: `startApiCall()` inside
    `maybeStartDirectApiRun` (`youtube.ts:2414`) — this is the cold click→run and
    auto-run path. That's the only call site.
  - The loading panel also owns the **90s loading-timeout → error panel** flow
    (`LOADING_TIMEOUT_MS`, `youtube.ts:678`, `:1325-1331`) and the
    `SET_SUMMARY_ERROR` handler keys off `summaryPanelKind === "loading"`
    (`youtube.ts:2599`).
- **Proposed:**
  - Drop the visible skeleton panel. In `startApiCall` replace
    `showLoadingPanel()` with `setWatchButtonState("analyzing")` directly (the
    button already renders "Analyzing…" + `tldw-shimmer` animation via
    `setWatchButtonState`, `youtube.ts:810-828`).
  - The real summary still replaces nothing visible — it just appears when
    `SET_SUMMARY` lands (`youtube.ts:2568-2591`).
- **Complications (must resolve, not skip):**
  1. **Timeout / error UX moves off the panel.** `summaryPanelKind === "loading"`
     is the trigger for both the 90s timeout error panel (`:1327-1330`) and the
     `SET_SUMMARY_ERROR` handler (`:2599`). If there's no loading panel, those
     conditions are never true and **errors go silent** — the button would just
     spin forever. Decide where errors surface: (a) flip the button to an error
     state ("Try again", red) and keep a lightweight timeout timer not tied to a
     panel, or (b) inject `showSummaryErrorPanel()` directly on
     timeout/`SET_SUMMARY_ERROR` even though there was no loading panel. **Recommend
     (b)** — reuse `showSummaryErrorPanel` but gate it on a new
     `runInFlight` boolean instead of `summaryPanelKind === "loading"`.
  2. **`setWatchButtonState("analyzing")` is a no-op if the button isn't mounted**
     (`youtube.ts:811` early-returns when `watchButton` is null). On a normal
     watch page the button is mounted by `ensureWatchButton()` (`:2376`) before
     `startApiCall`, so this is fine — but verify ordering after the edit.
  3. **`summaryPanelKind` state machine** referenced in `ensureWatchButton`
     (`:873`) and elsewhere assumes a "loading" kind exists. Removing the loading
     panel means "loading" is no longer a panel kind; audit every
     `summaryPanelKind === "loading"` read and replace with the in-flight flag.
- **Verdict:** Feasible, but this is the **highest-risk item in section A**
  because of the error/timeout coupling. Budget for it.

### A2. Enlarge the TL;DW icon in the injected panel header

- **Current:** `buildPanelHead()` builds the header `<img>` at
  `youtube.ts:1096-1098`: `icon.style.width/height = "28px"`, `borderRadius: "6px"`.
- **Proposed:** Bump to ~`32px` (or `34px`). The source asset is `tl-dw-32.png`
  (`:1097`) so 32px is pixel-perfect; larger upscales slightly. Bump
  `borderRadius` proportionally (e.g. `7px`).
- **Complications:** The header is `display:flex; align-items:center`
  (`:1094`), so a taller icon just grows the row height; the title text is
  `fontSize:15px` (`:1102`), so a 32px icon stays balanced. Trivial, low-risk.

### A3. Make the inline TL;DW button slightly taller (decouple from panel pills)

- **Current:** The inline button shares `pillGeom` (`youtube.ts:849-855`), whose
  height is the shared `PILL_HEIGHT = "30px"` (`:743-751`). That same constant
  governs **every** injected pill — rating buttons, auto-toggle, verdict pills,
  kebab, Get-Summary, etc. Bumping `PILL_HEIGHT` resizes all of them.
- **Proposed:** Give the inline button **its own height**. In `ensureWatchButton`
  (`:849-855`), spread `pillGeom` but then override `height` (and `boxSizing`
  stays `border-box`), e.g. `height: "36px"`. Don't touch `PILL_HEIGHT`.
- **Complications:** The button sits in YouTube's owner/subscribe row next to
  Subscribe and vidIQ's button (`:867-869`). YouTube's Subscribe pill is ~36px,
  so 36px actually aligns **better** with native controls. Watch that `marginLeft:8px`
  vertical centering still looks right (flex row, so it auto-centers). Low-risk.

### A4. Remove the "Block channel" feature entirely

The user is explicit: *"blocking a channel for TL;DW is not a thing."* This is a
**cross-file removal**. It also **contradicts item C8** (a "Blocked" tab) — see
the resolution note there. Blocking is going away, so **no Blocked tab**.

**Every surface that references blocking (scope of removal):**

| Layer | File:line | What it is |
| --- | --- | --- |
| Constant | `constants.ts:119-120` | `BLOCKED_CHANNELS_KEY = "tldwBlockedChannels"` |
| Type | `types/index.ts:105` | `export type BlockedChannel` |
| Storage lib | `storage.ts:3,19,683-707` | `getBlockedChannels`, `setBlockedChannels`, `addBlockedChannel`, `removeBlockedChannel` |
| Content (data) | `youtube.ts:422,429,431-434` | `BLOCKED_CHANNELS_KEY`, `BlockedChannelEntry`, `readBlockedChannels()` |
| Content (write) | `youtube.ts:458-474` | `addBlockedChannelEntry()` + `clearCachedSummariesForChannel()` (the latter is *only* used by block — confirm before deleting) |
| Content (kebab item) | `youtube.ts:1955-1966` | the "⊘ Block channel" menu row (the one "just added") |
| Content (enforcement) | `youtube.ts:2342,2361-2371` | the blocked check in `maybeStartDirectApiRun` that suppresses the panel + inline button |
| Content (message) | `youtube.ts:2553-2567` | `GET_CHANNEL_STATUS` handler returning `{ isBlocked, channelName }` |
| Options UI | `ChannelsSection.tsx:2-3,145-215,518,525-531,546-549,615-635` | imports, `BlockedCard` component, `blockedChannels` state, `reload()` fetch, `handleUnblock`, and the "Blocked — AI Summaries" JSX block |
| Stats UI (the *creator*) | `StatsSection.tsx:3,216-232,242,245,274-286,389-393,403-409,458-468` | `nudgeCandidate()`, the "Block channel?" nudge UI, `addBlockedChannel` call, `handledNudges`/`blockedNames` state |
| Popup | `App.tsx:3,100,130-138,389-401` | `ChannelStatusResponse`, `channelStatus` state, the `GET_CHANNEL_STATUS` round-trip, and the "is on your skip list / View Blacklist" banner |
| Type | `types/index.ts` | `ChannelStatusResponse` (used by popup + content) — search and remove |

**Notes for clean removal:**
- `StatsSection.tsx` is the **only place a block is created** (via the nudge);
  `youtube.ts` is where it's **enforced**. Removing UI alone leaves dead
  enforcement, so remove **all** layers.
- `clearCachedSummariesForChannel()` (`youtube.ts:458-466`) appears to be used
  only by `addBlockedChannelEntry` — verify with a grep before deleting; if used
  elsewhere, keep it.
- Existing users will have `tldwBlockedChannels` in `chrome.storage.local`.
  Decide: leave it as orphaned (harmless, small) or add a one-time migration that
  deletes the key. **Recommend** a tiny cleanup on next load (low effort, avoids
  confusion if blocking ever returns).
- **Contradiction resolved:** item C8's tab set is **"Channel History" +
  "Auto-run channels"** only. No "Blocked" tab.

---

# B. Popup — `src/popup/`

### B5. Shorten + shrink the first-run sponsor notice

- **Current copy** (`App.tsx:319-342`, styles `popup.css:142-188`):
  > "Heads up: TL;DW auto-skips sponsor segments — which sends the current
  > video's ID to the free SponsorBlock service — and measures your watch-time
  > locally to rate videos Engaged / Skimmed / Skipped. Everything stays on your
  > device; nothing is sent to us."
  >
  > Buttons: **[Got it]** and **[Turn these off in Settings]**.
- **Issues:** Long paragraph at `font-size:13px / line-height:1.45`
  (`popup.css:153-157`), `padding:12px 14px` (`:146`). It dominates the popup on
  first open.
- **Proposed tighter copy** (one line, still accurate + still dismissible):
  > "Heads up: TL;DW auto-skips sponsors (via SponsorBlock) and rates videos
  > from your local watch-time. All on-device. [Settings]"
  - Shrink: `font-size:12px`, `padding:8px 10px`, drop the second button or fold
    "Settings" into a small inline link. Keep the click-to-dismiss (`Got it`
    writes `firstRunNoticeSeen`, `App.tsx:329-333`) — that behavior stays.
- **Complications:** The copy is also a **compliance/privacy disclosure** (recent
  commits show a Chrome Web Store compliance pass). Don't trim it to the point of
  removing the "sends video ID to SponsorBlock" + "on-device" claims, which the
  store listing/justification may rely on. Keep both facts, just denser. **Flag
  for review against `docs/STORE_SUBMISSION.md`.**

### B6. Even spacing for the 4 destinations (Perplexity removed)

- **Current:** `DESTINATIONS` now has **4** entries — Gemini, ChatGPT, Claude,
  NotebookLM (`constants.ts:15-45`); Perplexity is gone. But the grid CSS is
  still `grid-template-columns: repeat(5, 1fr)` (`popup.css:213-217`). With 4
  buttons in a 5-column grid, the row has an **empty 5th cell** and the buttons
  are narrower/left-biased.
- **Proposed:** Change `popup.css:215` to `repeat(4, 1fr)`. The buttons are
  rendered by a `.map` over `availableDestinations` (`App.tsx:410-423`), so the
  count is data-driven — only the CSS column count is hardcoded.
- **Complications / edge case:** For **Shorts**, `availableDestinations` is
  filtered to only `canWatch` destinations (`App.tsx:185`) → just **Gemini** (1
  button). A `repeat(4,1fr)` grid then shows one button in the first cell with 3
  empty. Minor (Shorts is a narrow case), but if you want it tidy, set the column
  count from `availableDestinations.length` via an inline style, e.g.
  `gridTemplateColumns: repeat(${availableDestinations.length}, 1fr)`. **Recommend**
  the dynamic version — it's robust to future destination changes too.

### B7. Add a Ko-fi button at the bottom of the popup

- **Current:** The popup has no footer CTA. The root `.tldw` is a flex column
  (`popup.css:11-16`); the last rendered block is the "Recent" history section
  (`App.tsx:540-565`).
- **Proposed:** Add a small "☕ Buy me a Ko-fi" link as the final child of
  `.tldw`, opening `https://ko-fi.com/n8watkins` in a new tab via
  `chrome.tabs.create({ url: ... })` (the popup already uses this pattern at
  `App.tsx:473-475`). Style it muted/secondary so it doesn't compete with the
  primary send action.
- **Complications:** None functional — external links from a popup just open a
  tab. No host permission needed (it's a user-initiated `tabs.create`, not a
  fetch). Keep it visually quiet; the popup is task-focused.

---

# C. Options — Channels — `src/options/sections/ChannelsSection.tsx`

### C8. Replace the single scroll with tabs

- **Current:** One long vertical scroll, **no tabs**. Three stacked groups in
  source order (`ChannelsSection.tsx:586-698`):
  1. **Auto-run Channels** — header `:588-595`, list `:604-613` (`AutoRunCard`
     `:91-143`).
  2. **Blocked — AI Summaries** — header `:616-624`, list `:625-633`
     (`BlockedCard` `:147-215`). **→ deleted entirely per item A4.**
  3. **Channel History** — header `:638-679` (with a Sort `<select>` at
     `:649-658`), list `:686-696` (`ChannelCard` `:313-511`, expandable rows).
- **Proposed tabs:** **"Channel History"** and **"Auto-run channels"** (no
  "Blocked"). There's an existing tab visual style to mirror —
  `.directapi-tab` in `options.css:673-681` — so the look is already in the
  design system; lift it (or generalize to a shared `.tab` class).
- **Complications:**
  - The Sort `<select>` (`:649-658`) belongs to the Channel History tab; keep it
    inside that tab's content.
  - Naming overlaps with the separate **History** section (item C11). Resolve
    naming **before** labeling the tab to avoid shipping "Channel History" tab
    inside "Channels" while a sibling sidebar item is also "History."
  - The "Auto-run channels" tab will often be empty for new users — give it an
    empty state ("No auto-run channels yet. Turn on auto-summarize from any
    video's TL;DW panel.").

### C9. Tab content page-width, scrolls vertically within the tab

- **Current:** Section content sits in `<main className="content">`
  (`OptionsApp.tsx:84`); the whole page scrolls.
- **Proposed:** Make each tab's content fill the available width and own its
  vertical scroll (e.g. tab body `overflow-y:auto` with a max-height, or just let
  it flow page-width while the page scrolls — simplest). Cards already render
  full width.
- **Complications:** A nested scroll container inside an already-scrolling page
  can create a double-scrollbar feel. **Recommend** page-width + natural page
  scroll (no inner scroll container) unless the lists get very long; only add an
  inner scroll if testing shows the tab strip should stay pinned.

### C10. Contrast "bug" (really a CSS-variable typo)

- **Finding:** Not black-on-dark. Throughout `ChannelsSection.tsx`, metadata uses
  `color: "var(--text-muted)"` — e.g. last-watched/subtitle `:425`, "{n} videos"
  `:441`, "Added {timeAgo}" `:122`, VideoRow date `:299`, "{n} channels · {n}
  videos total" `:664`. **`--text-muted` is not defined** (`:root` has `--text`,
  `--muted`, `--faint` — `options.css:1-16`). The undefined var → inherited
  `--text` (`#f1f5f9`), so "muted" text renders **full-brightness**.
- **Proposed:** Replace every `var(--text-muted)` with **`var(--muted)`**
  (`#94a3b8`). The CSS classes already do this correctly (`.section-desc` →
  `var(--muted)` at `options.css:177`; `.history-meta` → `var(--muted)` at `:840`).
- **Complications:** None — it's a token rename. But it's worth a quick grep for
  `--text-muted` across the whole `src/` tree (the popup uses hex, but other
  inline-styled sections may have copied the same typo).

### C11. Naming: "Channel History" vs "History" — concrete proposal

- **What each means today:**
  - **History** (sidebar item, `OptionsApp.tsx:19`): heading
    `HistorySection.tsx:130`. A **flat, chronological per-search log** — one card
    per summary/search with video title, profile, timestamp, and the expandable
    prompt + Gemini response (`HistorySection.tsx:238-300`). Has its own search
    box (`:137-142`).
  - **Channel History** (inside the **Channels** section,
    `ChannelsSection.tsx:641`): the **same** underlying `getHistory()` data, but
    **grouped by channel** via `computeChannelStats(history)` (`:528`) into
    per-channel rollups (verdict, engagement, video count, last-watched,
    expandable video list). Described as *"Channels you've watched with TL;DW."*
  - So: same data, two lenses — **chronological log** vs **channel-grouped
    dashboard**. The word "History" on both is the collision.
- **Recommended naming scheme:**
  - Keep the sidebar **"History"** as-is (it's the literal activity log).
  - Rename the **Channels** section's sub-view from "Channel History" → **"Your
    channels"** (or **"Watched channels"**). It's a channel dashboard, not a
    history.
  - Tabs inside Channels (item C8) then read cleanly: **"Your channels"** +
    **"Auto-run channels"** — no "History" word inside the Channels section at
    all.
  - Update the section description (`:642-644`) to match, e.g. "Channels you've
    summarized, grouped with their watch stats."
- **Open question:** Is the sidebar label **"Channels"** still clear if its first
  tab is "Your channels"? Possibly redundant. Alternative: sidebar **"Channels"**,
  tabs **"Watched"** + **"Auto-run"**. Pick one and apply consistently.

### C12. Channel search (by name) + tag filter; richer suggested tags

- **Current:** ChannelsSection has **no search box and no tag filter** — only the
  Sort `<select>` (`:649-658`). (HistorySection *does* have a text search,
  `HistorySection.tsx:137-142`, which is a good pattern to copy.)
- **Suggested tags live in** `TagsSection.tsx:9-14`, a module-level `EXAMPLES`
  array — only **4**: Citations, Tutorial, Pricing, Counterpoints (rendered as
  one-click "+" buttons, `:125-129`, filtered to unused via `unusedExamples`
  `:65-67`). There is **no** shared/default tag list in `constants.ts`.
- **Proposed:**
  1. Add a **channel name search** input to the Channel History / "Your channels"
     tab (mirror `HistorySection`'s input + filter; channels come from
     `computeChannelStats`, filter on `ch.channel`).
  2. Add a **tag filter**: channel→tag assignments live in
     `tldwChannelTags` (`Record<channelKey, tagId[]>`, `constants.ts:130-133`).
     Resolve tag ids against the `tldwTags` library and offer a tag multi-select /
     chip filter. The `channelKey` is `getChannelInfo().id || name`
     (`youtube.ts:579-581`) — match carefully so the filter lines up with what
     the widget writes.
  3. **Richer suggested tags** — extend `EXAMPLES` (`TagsSection.tsx:9-14`), or
     better, lift the list into `constants.ts` as the single source of truth so
     both Tags and Channels can reference it. Proposed additions (label →
     intent): **News/Update**, **Deep-dive**, **Opinion/Take**, **How-to**,
     **Product review**, **Interview**, **Research/Paper**, **Drama/Recap**,
     **Finance**, **Quick watch**. Keep prompts short and in the same voice as
     the existing four.
- **Complications:** Tag filtering needs to load `tldwTags` + `tldwChannelTags`
  in the section (it currently doesn't import them). Moderate effort. Channel
  search alone is low effort. **Recommend** shipping search first, tag filter
  second.

---

# D. Options — Stats — `StatsSection.tsx` + `lib/`

> ⚠️ The brief references `src/lib/stats.ts` — **it does not exist** (only
> `stats.test.ts`). The aggregation logic lives in `src/lib/history.ts`
> (`computeChannelStats`) and `src/lib/dashboards.ts` (windowing); the persisted
> stats writer is in `src/lib/storage.ts`; types in `src/types/index.ts`.

### D13. More detailed stats: most-engaged channels + time-per-channel (persisted)

- **What exists today:**
  - **All-time** cards (`StatsSection.tsx:503-637`): videos summarized, time
    saved, sponsor time skipped, engagement donut (engaged/skimmed/skipped),
    activity heatmap + streak, instant summaries, hours previewed, **Top
    channel** (`:603-612`), **Channels explored** (`:614-619`), API calls today.
  - **Windowed** view (`WindowedView` `:234-378`): includes **"What you
    watched"** — top-5 channels by video **count** with a derived "% engaged"
    label (`:316-338`).
  - Persisted stats (`TLDW_STATS_KEY = "tldwStats"`, type `LifetimeStats`,
    `types/index.ts:176-202`): **all global scalars** — `secondsWatched` is a
    single lifetime sum across **all** videos; engaged/skimmed/skipped are global
    counters; `activity` is a per-day summary count (capped 366). **No
    per-channel field exists.**
  - Per-channel data is computed **on the fly** from `history[]` via
    `computeChannelStats` (`history.ts:88-124`) — `ChannelStats`
    (`history.ts:74-85`) has `count`, `avgAiRating`, `avgUserRating`,
    `userBreakdown {engaged,skimmed,skipped}`, `lastWatched`, `videos[]` — but
    **no `watchTimeSeconds`**.
  - **"Top channel" today = most videos, not most engaged** (count-sorted,
    `history.ts:123`). And it's only as complete as the retained history window
    (capped by `historyLimit` default 100, expired after `historyExpiryDays`
    default 30 — `history.ts:11-35`).
- **So both user asks need NEW persisted fields:**
  1. **Most-engaged channel** — needs an engagement-based rank (e.g. engaged
     count, or engaged ratio), persisted so it survives history pruning.
  2. **Time per channel** — needs per-channel `watchTimeSeconds`, which is not
     stored anywhere today.

#### Storage / quota assessment (this is the load-bearing part)

- **`unlimitedStorage` is NOT in the manifest** (`manifest.config.ts:85`:
  `["storage","tabs","contextMenus","clipboardWrite"]`). So the default
  `chrome.storage.local` quota applies (~5 MB hard).
- **Current keys are all bounded** — nothing grows unbounded:

  | Key | Growth | Bound |
  | --- | --- | --- |
  | `tldwStats` | fixed scalars + `activity` map | `activity` trimmed to newest **366** days |
  | `history` | one row per video | capped by `historyLimit` (def 100) + `historyExpiryDays` (def 30) |
  | `tldwSummaryCache` | per video | TTL 7d + hard cap **300** (`pruneCache`) |
  | `geminiCallLog` | per call | capped **200** |
  | auto-run / tags maps | per channel/video | user-driven, small |

- **Cost of a per-channel aggregate:** `{ watchTimeSeconds, videoCount,
  engagedCount, lastWatched }` ≈ **80–120 bytes JSON/channel**. A heavy user with
  ~500 distinct channels ≈ **40–60 KB** — trivial vs ~5 MB, **if capped**.
  Without a cap it grows one entry per distinct channel ever watched → must be
  bounded.

#### Recommended data-shape + retention

- **Add a `channels` map to `LifetimeStats`** (`types/index.ts:176-202`):
  ```ts
  channels: Record<channelKey, {
    name: string;
    watchTimeSeconds: number;
    videoCount: number;
    engaged: number; skimmed: number; skipped: number;
    lastWatched: string; // ISO
  }>
  ```
  Rationale: `LifetimeStats` is the **never-pruned** store and already rides the
  serialized read-modify-write in `bumpLifetimeStats` (`storage.ts:587-597`). The
  writer `recordWatchProgress` (`storage.ts:161-274`) **already has the channel
  name** (`video.channel`, `:166`) at the exact point it does
  `s.secondsWatched += deltaSeconds` (`:253`) — add a per-channel bump right
  beside the global one. This survives history pruning (the requirement) and adds
  zero new storage keys.
- **Bound it** the same way `activity` is bounded: on each write, cap to the
  newest ~**500** channels by `lastWatched` (a `trimActivity`-style trim,
  `storage.ts:560-571`). Channels falling off the tail lose their aggregate —
  acceptable; they're the least-recently-watched.
- **For the UI read shape**, extend `ChannelStats` (`history.ts:74-85`) with
  `watchTimeSeconds` so "most engaged" (sort by `engaged`) and "time per channel"
  (sort by `watchTimeSeconds`) read one struct. But the **source of truth must be
  the persisted `tldwStats.channels`**, not `computeChannelStats(history)`, since
  history is windowed.
- **Caveat to surface in review:** Existing users start from zero per-channel
  time (no backfill possible — watch-time deltas weren't recorded per channel).
  The new cards will populate going forward. Consider a "since you updated" note
  or seed from `history[]` on first run (partial, only the retained window).

---

# E. Options — Support / About

### E14. "Buy Me a Coffee" → on-brand "Buy Me a Ko-fi"

- **Current:** `SupportSection.tsx:5` `COFFEE_URL =
  "https://www.buymeacoffee.com/n8watkins"`; rendered as the primary card
  `:18-24` with label **"Buy a coffee"** + `Icon name="coffee"`.
- **Proposed:** Repoint to `https://ko-fi.com/n8watkins`, relabel to **"Buy me a
  Ko-fi"** (or "Support on Ko-fi"). Keep the `coffee` icon (it's generic enough),
  or add a `ko-fi` icon to `Icons.tsx`.
- **Complications:** None. One URL + one label. Make sure the **popup** (item B7)
  uses the **same** URL so they don't diverge.

### E15. Version display: header + About; remove from Support

- **Current version is shown in THREE places already:**
  1. Sidebar **footer** (`OptionsApp.tsx:78-81`): "Version v{...}".
  2. **Support** panel (`SupportSection.tsx:8,43-46`): "Current version v{...}".
  3. **About** hero badge (`AboutSection.tsx:6,20`): `<span
     className="about-version">v{version}</span>`.
- **Version source of truth (solid):** `package.json` `version`
  (currently **`0.1.158`**, `package.json:3`) → `manifest.config.ts:2,8`
  (`pkg.version`) → built manifest → all UIs read
  `chrome.runtime.getManifest().version`. No hardcoded versions anywhere.
- **Proposed:**
  - Put the version **next to the page title**. ⚠️ There is **no top page
    header** — the "TL;DW" title lives in the **sidebar logo block**
    (`OptionsApp.tsx:59-65`, `logo-text` at `:62`). Add the version next to
    `logo-text` there. (The sidebar **footer** version at `:78-81` is then
    redundant — **recommend removing the footer one** so the version shows once
    in the sidebar, next to the title.)
  - **Keep** it in **About** (`AboutSection.tsx:20`).
  - **Remove** it from **Support** (`SupportSection.tsx:8,43-46` — delete the
    `version` const + the `version-panel` div).
- **Complications:** "Header" is ambiguous because there's no header bar. The
  natural place is the sidebar logo. If the user actually wants a real top header
  bar, that's a larger layout change — **flag this as a clarification**: *does
  "options page header" mean the sidebar logo area, or a new top bar?*

### E16. Support: plug the dev (n8builds.dev + Appturnity), framed around code/content + Ko-fi

- **Current:** Support has only 3 cards — coffee, GitHub repo, Report an issue
  (`SupportSection.tsx:17-41`). **No** personal-site or consulting links anywhere
  in `src` (grep confirmed: no natebuilds, no Appturnity, no ko-fi).
- **Proposed:** Reframe Support as "support the dev + their work." Card set:
  1. **Buy me a Ko-fi** → `https://ko-fi.com/n8watkins` (item E14).
  2. **n8builds.dev** → personal site `https://n8builds.dev`.
  3. **Appturnity** → consulting brand `https://appturnity.com/`.
  4. Keep **GitHub repo** + **Report an issue**.
  - Add `link`/`external` icons as needed (`Icons.tsx` already has `external`
    `:31` and `github` `:39`; add a generic `link`/`globe` if you want distinct
    iconography for the personal site).
  - Update the section description (`:14`) to match the new framing.
- **Complications:** Need the two missing facts (n8builds.dev exact URL,
  Appturnity URL) before this can ship. Otherwise straightforward — same
  `support-card` pattern.

---

# F. Cross-cutting

### F17. Contrast audit of every options section

**Theme mechanism:** dark-only CSS vars on `:root` (`options.css:1-16`); tokens
are `--text`, `--muted`, `--faint`, `--border`, `--surface`, `--bg`, `--danger`,
`--success`. No light mode.

| Section | File | Finding |
| --- | --- | --- |
| Channels | `ChannelsSection.tsx` | **Typo'd `var(--text-muted)`** (undefined) on metadata — `:122,179,299,425,441,664`. Renders un-muted. Fix → `var(--muted)`. White-on-color pills (`:43-47,72,191,373`) are intentional and fine. |
| Stats | `StatsSection.tsx` | Heavy hardcoded hex for chart/donut colors (`:250-252` engaged/skimmed/skipped greens/yellows/reds; hero `#2dd4bf` `:264`). These are **data-viz accents**, intentional, readable on dark. Verify any **text** color is a token, not a one-off gray. |
| Support | `SupportSection.tsx` | Uses class-based styling (`support-card`, `version-panel`) → inherits tokens. Clean. |
| About | `AboutSection.tsx` | Class-based (`about-*`, bento cards). Clean. Content staleness, not contrast (see F18). |
| History | `HistorySection.tsx` | `.history-meta` → `var(--muted)` (`options.css:840`). Clean. |
| Tags | `TagsSection.tsx` | Class-based. Verify ghost-button hover contrast, but no obvious hardcoded text-color issues. |
| Profiles / Settings / Setup / DirectApi | respective files | Not deeply audited here — **action item:** grep each for `var(--text-muted)` and for raw `color: "#..."` on text (not on colored backgrounds). |

**Recommended action:** grep `src/options/` for `--text-muted` (the typo) and for
inline `color:` hex on text. Standardize on `--text` / `--muted` / `--faint`.

### F18. Frontend integration audit — wired vs dead/placeholder

| Surface | Status | Notes |
| --- | --- | --- |
| **Popup — dest grid** | Wired | `.map` over `availableDestinations` (`App.tsx:410-423`). **Stale CSS**: `repeat(5,1fr)` for 4 dests (item B6). |
| **Popup — Direct API / usage** | Wired | `geminiUsage` real (`App.tsx:99,452-483`). |
| **Popup — history/open searches** | Wired | Real `getHistory` / `getOpenSearches`. |
| **Popup — channel-status banner** | **Dead after A4** | "is on your skip list / View Blacklist" (`App.tsx:389-401`) backs the block feature being removed. Delete with A4. |
| **Popup — first-run notice** | Wired | Real `firstRunNoticeSeen` toggle. Just needs shrinking (B5). |
| **Stats — all cards** | Wired | Real `LifetimeStats` + `computeChannelStats`. **"Top channel" = most videos, not most engaged** (item D13) — arguably mislabeled. |
| **Stats — "Block channel?" nudge** | **Dead after A4** | `StatsSection.tsx:274-286` is the *only creator* of blocks. Remove with A4. |
| **Channels — Blocked list** | **Dead after A4** | `BlockedCard` + "Blocked — AI Summaries" block (`:145-215,615-635`). Remove. |
| **Channels — search / tag filter** | **Missing** | Not built yet (item C12). |
| **About — "5 AI destinations"** | **Stale / Perplexity remnant** | `AboutSection.tsx:82` hardcodes the title **"5 AI destinations"** but maps `DESTINATIONS` which now has **4** (`:87`). Title says 5, grid shows 4. Fix to "4 AI destinations" (or derive `{DESTINATIONS.length}`). |
| **Support — version panel** | Wired but **to be removed** (E15) | Redundant once version moves to header. |
| **Support — dev plugs** | **Missing** | n8builds.dev / Appturnity not present (E16). |
| **On-page — loading panel** | Wired but **to be removed** (A1) | Sole caller `youtube.ts:2414`; coupled to error/timeout flow. |
| **On-page — Block channel kebab** | **To be removed** (A4) | `youtube.ts:1955-1966`. |
| **Constants/storage — `BlockedChannel*`** | **Dead after A4** | `constants.ts:119-120`, `storage.ts:683-707`, `types/index.ts:105`. |

**Perplexity remnants found:** the destination set is already 4 (no Perplexity in
`DESTINATIONS`), but two stale references assume 5: the popup `dest-grid` columns
(`popup.css:215`) and the About card title "5 AI destinations"
(`AboutSection.tsx:82`). Both should be fixed.

---

# Open questions / decisions for the user

1. **Brand URLs (blocking E16):** Confirm `n8builds.dev` exact spelling and
   that it resolves. Provide the **Appturnity** URL.
2. **"Options page header" (E15):** There's no top header bar — the title is in
   the **sidebar logo**. Is putting the version next to the sidebar logo
   acceptable, or do you want a new top header bar (larger change)? And should
   the **sidebar-footer** version be removed to avoid showing it twice in the
   sidebar?
3. **Naming (C11):** Recommend renaming the Channels section's "Channel History"
   → **"Your channels"** (or sidebar "Channels" with tabs "Watched" +
   "Auto-run"), and keeping the standalone **"History"** as the activity log.
   Confirm the preferred labels before wiring tabs (C8).
4. **Per-channel stats storage (D13):** Recommend a bounded `channels` map inside
   the never-pruned `tldwStats` (cap ~500 by `lastWatched`), populated forward
   from `recordWatchProgress`. **No `unlimitedStorage` needed.** Confirm it's OK
   that existing users start from zero (no historical backfill of per-channel
   time), and that "most engaged" should rank by **engaged count/ratio**, not
   video count (which is what "Top channel" does today).
5. **First-run notice (B5):** The copy doubles as a privacy disclosure tied to
   store compliance — confirm the tighter copy still satisfies
   `docs/STORE_SUBMISSION.md` (keep "sends video ID to SponsorBlock" +
   "on-device").

---

# Rough priority ordering

**P0 — small, high-value, low-risk (do first):**
- B6 dest-grid `repeat(4,1fr)` (or dynamic) — 1-line fix, visible bug.
- A2 enlarge panel icon; A3 taller inline button — cosmetic, isolated.
- C10 `--text-muted` → `--muted` token fix — quick correctness fix.
- About "5 AI destinations" → 4 (or `DESTINATIONS.length`) — stale copy.
- E14 coffee → Ko-fi URL/label; B7 Ko-fi button in popup (share the URL).

**P1 — medium, clear scope:**
- A4 remove Block feature end-to-end (touches many files but mechanical).
- E15 version to header + remove from Support (resolve the "header" question).
- B5 shrink first-run notice (after compliance check).
- C8/C9 Channels tabs + layout (after C11 naming decision).
- C11 naming rename.

**P2 — larger / needs decisions or new data:**
- E16 dev plugs (blocked on brand URLs).
- C12 channel search (easy) + tag filter (medium) + richer suggested tags.
- D13 per-channel persisted stats (new storage field, UI, retention) — the
  biggest single item.

**Highest-risk item overall:** **A1** (removing the loading panel) — not because
the UI change is hard, but because the loading panel is the anchor for the
timeout/`SET_SUMMARY_ERROR` error flow. Don't ship it without rehoming error
handling onto an in-flight flag.
