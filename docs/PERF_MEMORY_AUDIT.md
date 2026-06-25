# TL;DW — Memory & Performance / Optimization Audit

> Read-only audit (no code changed). File:line anchors are against the tree at
> the time of writing and will drift. Findings are ranked **High / Med / Low** by
> real-world impact, with concrete cost + a specific recommendation each. The
> distinction throughout is **real risk** (will bite a heavy multi-year user)
> vs **theoretical** (clean to fix, but unlikely to matter at realistic scale).
>
> _Audited: 2026-06-25._

> **Update (2026-06-25): top items resolved.** ① Unbounded video-tag map — now
> swept against history on startup (`pruneOrphanVideoTags`). ② 500ms poll — added
> an `isConnected` fast-path in `ensureWatchButton` (the single-write watch-path
> fold was **declined**: `history` and `tldwStats` use separate write-locks other
> writers depend on). ③ 167 KB `claude-icon.png` — replaced with an inline brand
> SVG; asset deleted. ④ Stale "~10 MB" comments — corrected to ~5 MB. The
> `videosWatched` seen-set was **declined** per this audit (it would become the
> storage risk it set out to fix). **List virtualization (Med): done** — Channels
> (both tabs) + History now window via `@tanstack/react-virtual` with measured
> heights (`src/options/components/VirtualList.tsx`); search composes by passing
> the filtered array as `items`.

---

## Top 5 actions (do these, in order)

1. **Prune orphaned channel/video tag maps.** `tldwChannelTags` (keyed by channel
   name) and `tldwVideoTags` (keyed by videoId) are the **only** storage maps with
   **no cap and no eviction** — `storage.ts:832-849` only strips a *deleted tag id*,
   never an orphaned channel/video key. Every tagged channel/video adds a permanent
   entry that outlives history expiry. Add a bounded cap (e.g. 500 channel keys /
   1000 video keys, LRU-style) or a startup sweep that drops video-tag keys whose
   videoId is no longer in history. *Real, though slow-growing.*

2. **Make the `onNavigate` 500ms poll cheaper / self-throttling**
   (`youtube.ts:2470`). It runs on **every** youtube.com page (not just `/watch`),
   forever, doing `currentVideoId()` + `ensureWatchButton()` (which runs
   `getElementById` + `ownerRow()` querySelectors) twice a second. It's not a leak,
   but it's perpetual idle CPU on every open YouTube tab. Short-circuit when the
   button is already mounted and connected, and bail early off `/watch`.

3. **Collapse the watch-time hot path to fewer serialized writes**
   (`storage.ts:179-298`). Each `WATCH_PROGRESS` (every ~10 watched content-seconds,
   plus on every tab hide/pagehide) does **two** independent `withWriteLock` RMW
   cycles (`mutateHistory` + `bumpLifetimeStats`), each a full
   read-deserialize-mutate-serialize-write of `history` and `tldwStats`. As
   `tldwStats.channels` and `history` grow, this read-modify-write cost grows with
   them. Consider merging the stats write into the history lock pass, or batching.

4. **Cap the rendered channel list in the options Channels view**
   (`ChannelsSection.tsx:729` `visibleAll.map(...)`). With `historyLimit:"unlimited"`
   + `CHANNEL_STATS_CAP=500`, this renders **every** channel card (each with an
   expandable video list) unvirtualized. Add a "show more" page (e.g. 50 at a time)
   or virtualize. Same caution applies to `HistorySection` (`:238`) when
   `historyLimit` is unlimited.

5. **Confirm the 146 KB "DestinationIcon" chunk is the shared React vendor bundle,
   not the icon** (it is — see §5). The actual avoidable bytes are the **167 KB
   `claude-icon.png`** raw PNG (`src/assets/claude-icon.png`), loaded for a 28px
   icon. Downscale/convert to a ~2-4 KB WebP/SVG. Don't chase the "146 KB icon" —
   that number is React+ReactDOM.

---

## 1. Persisted storage growth (`chrome.storage.local`, ~5 MB quota, no `unlimitedStorage`)

The manifest grants no `unlimitedStorage` (`manifest.config.ts:85`), so the hard
~5 MB `chrome.storage.local` quota applies. (Several code comments still say
"~10 MB" — `constants.ts:79`, `storage.ts:554`, `background/index.ts:555` — that's
stale; the per-extension `local` quota is ~5 MB unless `unlimitedStorage` is
granted. Harmless, but worth correcting since the bounds reasoning leans on it.)

### Every key written, and what bounds it

| Key (area) | Shape | Bound | Worst-case |
|---|---|---|---|
| `history` (local) | `SearchHistoryEntry[]` | `historyLimit` (def **100**, can be **"unlimited"**) + `historyExpiryDays` expiry; swept on write AND on startup (`background/index.ts:84-107`) | def: ~100 × ~0.3-1 KB = **30-100 KB**. **"unlimited" removes the cap** → grows with the prompt string per entry |
| `tldwStats` (local) | `LifetimeStats` | scalars + `activity` (trim 366, `storage.ts:585-596`) + `channels` (trim **500**, `stats.ts:22-38`) | activity ≤ ~366×~12 B ≈ 4 KB; channels ≤ 500 × ~120 B ≈ **60 KB**. **Bounded.** |
| `tldwSummaryCache` (local) | `Record<videoId, CachedSummary>` | TTL 7d + cap **300** via `pruneCache` (`constants.ts:80-102`); swept on write + startup | 300 × (summary text, ~1-3 KB) ≈ **0.3-1 MB**. The single largest key; bounded. |
| `geminiCallLog` (local) | `GeminiCallEntry[]` | cap **200** (`storage.ts:467,523`); prompt/response only kept if `keepFullCallLog` | metadata-only: ~200×~150 B = 30 KB. **With `keepFullCallLog` on**: 200 × (prompt+response, can be many KB) → **could reach 1-2 MB.** Bounded by count, not bytes. |
| `geminiUsage` (local) | fixed scalars | constant | <1 KB |
| `autoRunChannels` (local) | `AutoRunChannel[]` | user-driven (only channels the user opts in) | tiny |
| `profiles`, `settings` (local) | fixed-ish | user-driven, small | <5 KB |
| **`tldwChannelTags`** (local) | `Record<channelName, tagId[]>` | **NONE** | **unbounded** — one key per tagged channel, forever |
| **`tldwVideoTags`** (local) | `Record<videoId, tagId[]>` | **NONE** | **unbounded** — one key per tagged video, forever |
| `pendingPrompts`, `openSearches`, `deliveryStatus` | session | session-scoped (cleared on browser restart) + capped (20/10) | n/a — `chrome.storage.session`, not `local` |

### Findings

**[High] `tldwChannelTags` / `tldwVideoTags` are the only unbounded local maps.**
- Evidence: written at `youtube.ts:575-595,621` (content script) and the options
  Tags surface. The *only* cleanup is `deleteTagEverywhere` (`storage.ts:832-849`),
  which removes a **deleted tag id** from every bucket — it never removes a
  channel/video **key**. `expireOldEntries` / `trimToLimit` (`history.ts`) prune
  `history` but nothing touches the tag maps. Confirmed: a grep for any
  prune/expire/orphan handling of these two keys returns nothing.
- Cost: `tldwVideoTags` grows one entry (`videoId` ≈ 11 B + a few tag-id UUIDs ≈
  ~50-100 B) **per one-off tagged video, permanently** — even after that video's
  history row expires (30 days default). `tldwChannelTags` grows per tagged
  channel. For a power user who tags hundreds of videos/year over multiple years,
  this is the realistic path to slow quota creep — small per entry, but the
  **only** key with no ceiling. The video map is the faster-growing of the two
  (per-video vs per-channel).
- Recommendation: (a) cap both maps LRU-style on write (mirror `trimChannelStats`),
  e.g. 500 channel keys / 2000 video keys; OR (b) in `startupStorageSweep`
  (`background/index.ts:84`) drop any `tldwVideoTags` key whose videoId no longer
  appears in `history` (orphan-by-expiry) — channel tags are intentionally durable
  so leave them, just cap them. (a)+(b) together is cheap and closes the only real
  unbounded-growth vector.

**[Med] `geminiCallLog` with `keepFullCallLog` enabled can hold ~200 full
prompt+response pairs.** `keepFullCallLog` defaults **off** (`constants.ts:170`),
so this is opt-in. Bounded by count (200) not bytes, so 200 large transcripts'
worth of prompts could reach ~1-2 MB. Low likelihood (off by default, debug-only),
but if a user enables it the byte cap is uncontrolled. Recommendation: when
`keepFullCallLog` is on, also cap stored prompt/response length (e.g. truncate to
8 KB each) or lower the entry count.

**[Med] `historyLimit: "unlimited"` removes the only count bound on the largest
churning key.** `history` is the most-written local key and each entry carries a
prompt string. With "unlimited" selected, only `historyExpiryDays` (if
`autoExpireHistory` is on) bounds it; with expiry also off, it grows forever. Plus
the watch-time engine creates a **stub history row per watched video** even with no
summary (`storage.ts:220-235`), so "unlimited" + heavy passive watching grows
history faster than summary count implies. Recommendation: keep a hard safety
ceiling even under "unlimited" (e.g. 5000 rows) so a quota wall can't be hit
silently; surface the count in the History UI.

**[Low] Total realistic footprint is well under quota.** Summing the *bounded*
keys at default settings: cache ≤ ~1 MB, channels ≤ 60 KB, history ≤ 100 KB,
call log ≤ 30 KB, activity ≤ 4 KB → **~1.2 MB**, comfortably under 5 MB. The 5 MB
quota is **not** at realistic risk for a heavy multi-year user *as long as* (a) the
tag maps get a cap and (b) "unlimited" history gets a safety ceiling. Without those
two, a multi-year power-tagger is the one profile that could creep toward it.

### The `videosWatched` over-count question (per the open question)

`bumpChannelStat` increments `videosWatched` when `wasNewEntry` is true — i.e. when
`recordWatchProgress` created the first history row for a video
(`storage.ts:177,672`). After that row is pruned (age/limit), a re-watch creates a
*new* first row and **re-increments** the counter (the code comment at
`storage.ts:638-643` documents this honestly). So `videosWatched` is a lifetime
**approximation that over-counts re-watches of pruned videos**, never an exact
distinct count.

**Recommendation: do NOT add a persisted "seen video IDs" set. Not worth the cost.**
- Size: an exact count needs a per-channel set of distinct videoIds that survives
  history pruning. At ~11 B/videoId, a single heavy channel (say 1000 videos) is
  ~11 KB; across the 500-channel cap, worst case is on the order of **hundreds of
  KB to low MB** — i.e. it could **dwarf the entire rest of `tldwStats`** and is the
  kind of per-dimension-keyed growth this audit otherwise flags as the risk. You'd
  also need to bound *each* set (another cap), reintroducing the same
  approximation at the set level.
- Value: `videosWatched` feeds an "at-a-glance" stat. The over-count only triggers
  on a re-watch *after* the video's history row expired — a narrow case — and
  inflates by 1, not by orders of magnitude.
- Better-if-wanted: dedup against the **retained history window** at write time
  (check whether *any* current history row exists for the videoId before
  incrementing, regardless of channel-name match) — that removes the most common
  double-count (same session / within the retention window) for **zero** extra
  storage, leaving only the post-expiry re-watch as an accepted approximation.
  Document the field as "approximate" in the UI either way.

---

## 2. Content-script runtime memory + leaks

All three YouTube content scripts (`youtube.ts`, `sponsorblock.ts`, `watchtime.ts`)
plus the MAIN-world interceptor match `https://www.youtube.com/*` — **every**
YouTube page, not just `/watch` (`manifest.config.ts:48-68`). So everything below
runs on the homepage, search, channel pages, Shorts feed, etc.

**[Low/clean] Listener hygiene is genuinely good — no per-rebuild leak found.**
- The popover/panel pattern aggregates every teardown into a `cleanups` array and
  exposes it as `__tldwCleanup` on the panel node (`youtube.ts:2069-2072`);
  `removeSummaryPanel` (`:682-689`) invokes it before removing the node, and is the
  single removal path called on every nav (`:2448`) and rebuild. Document-level
  popover listeners (`click`/`keydown` capture, `:914-924`) are added on open and
  removed on close + on teardown. The `armTimer` is cleared. This is the right
  design; I found no `addEventListener` that accumulates per panel-rebuild or
  per-nav.
- Per-element listeners (mouseenter/leave/click) live on nodes that are removed
  with the panel, so they're GC'd with it.
- `watchtime.ts` / `sponsorblock.ts` `attach()` both guard `if (v === video)
  return` and `removeEventListener` the old element before rewiring
  (`watchtime.ts:247-253`, `sponsorblock.ts:183-188`) — no video-listener
  accumulation across SPA nav (YouTube reuses the `<video>` element).
- Module-level singleton listeners (`message`, `visibilitychange`, `pagehide`,
  `yt-navigate-finish`, `storage.onChanged`) are each added **once** at module load
  — fine.

**[Med] The 500ms `setInterval(onNavigate, 500)` is perpetual idle work on every
YouTube tab.** (`youtube.ts:2470`)
- Per tick when the URL is unchanged (the steady state, ~99% of ticks): `vid =
  currentVideoId()` (one `URLSearchParams` parse of `location.search`) → on a watch
  page, `ensureWatchButton()` which does `document.getElementById(WATCH_BTN_ID)`
  (cheap) and, **only if the button is missing**, `ownerRow()` (up to 3
  querySelectors). Then a string compare against `lastHandledUrl` and an early
  return. So in steady state it's ~1 `getElementById` + 1 URL parse per 500 ms per
  tab — small, but it never stops, runs on non-watch pages too, and is multiplied
  by every open YouTube tab.
- `sponsorblock.ts` and `watchtime.ts` add their **own** 1000 ms `setInterval`
  (`:220`, `:358`) calling their `handleNav`, which each early-return on unchanged
  videoId. So three independent polls run concurrently per tab.
- Cost is genuinely low per tick, but it's the clearest "wasteful steady-state"
  item. Cheaper options: (1) short-circuit `ensureWatchButton` when
  `watchButton?.isConnected` is true (skip the `getElementById`); (2) bail
  `onNavigate` immediately when `!location.pathname.startsWith("/watch")` before
  any DOM work; (3) replace the URL-change detection with the existing
  `yt-navigate-finish` event + a single shared low-frequency MutationObserver on
  the owner row to re-mount the button on YouTube's re-renders, instead of polling.
  The button re-mount is the *only* reason the poll must stay this frequent — an
  `isConnected` short-circuit removes ~all of its per-tick cost.

**[Low] `currentVideoId()` is called many times per tick/run.** It re-parses
`location.search` via `new URLSearchParams` on every call (`youtube.ts:22-23`), and
the nav/stale guards call it repeatedly (`stale()` at `:2267` calls it on every
check). Cheap individually; could memoize per tick. Theoretical.

**[Low] Closures capturing large objects — none problematic.**
- The intercepted transcript is held in a single module-level `captured` string
  (`youtube.ts:38`), replaced wholesale on each new capture and gated by videoId —
  it does **not** accumulate; at most one transcript (tens-hundreds of KB) is
  resident. Good.
- `activeTranscriptFetch` is nulled in a `finally` (`:347`) and on nav (`:2453`).
- Summary objects (`TldwSummary`) are small; channelStats passed to the panel are
  `Pick`-narrowed (`background/index.ts:33-36`) — no full history retained in a
  panel closure.

**[Low] MAIN-world interceptor does not retain bodies.** `youtube-intercept.ts`
clones each transcript/timedtext response, reads it to text/json, `postMessage`s it,
and drops it — `.then(...).catch(() => {})` with no retained reference
(`:59-81`). No accumulation. The only cost is `res.clone()` + a parse per
transcript/caption fetch, which is infrequent (once per video's transcript open).

---

## 3. Hot-path CPU / redundant work

**[Med] `WATCH_PROGRESS` does two serialized RMW writes per fire, on a hot path.**
- Cadence: `watchtime.ts` reports every **10 accumulated watched content-seconds**
  (`REPORT_INTERVAL_S`, `:50,226`), **plus** a forced flush on `visibilitychange`
  (hidden) and `pagehide` (`:324-332`) and on nav-away (`:277`). So during active
  watching it's roughly one message every 10 s of content, more if the user
  tab-switches.
- Each `WATCH_PROGRESS` runs `recordWatchProgress` (`storage.ts:161-298`) which
  performs: **(1)** `mutateHistory` — a full `withWriteLock` cycle that reads,
  deserializes, scans, mutates, re-serializes and writes the **entire `history`
  array**; then **(2)** `bumpLifetimeStats` — another full `withWriteLock` cycle
  reading/writing the **entire `tldwStats`** object (now including the up-to-500
  `channels` map), running `trimActivity` + `trimChannelStats` (each an
  `Object.keys` + sort) on every write; then **(3)** conditionally a third
  `withWriteLock` on the summary cache to mirror the rating (`:289-296`) — but only
  when a verdict is set.
- The new per-channel bump itself is cheap (object field math, `storage.ts:645-680`),
  BUT it rides inside `bumpLifetimeStats`, whose serialize/deserialize cost now
  scales with the `channels` map size, and `trimChannelStats` sorts up to 500 keys
  **on every watch-progress write** even when nothing was evicted. So the per-channel
  feature did add steady-state cost to the hottest write path — modest, but real and
  growing with channel count.
- Recommendation: (1) skip `trimChannelStats`/`trimActivity` when the map is under
  cap (early-return already exists in both — `stats.ts:27`, `storage.ts:590` — so
  the *sort* is avoided; the residual cost is the full read/serialize of a 60 KB
  object per write). (2) Bigger win: fold the stats bump into the **same** write
  lock pass / batch the history+stats writes so a single `WATCH_PROGRESS` is one
  RMW, not two. (3) Consider raising `REPORT_INTERVAL_S` or coalescing reports when
  the tab is backgrounded.

**[Med] Redundant `getHistory()` + `computeChannelStats(history)` on the Direct-API
summary path.** In `runSummary` the Direct-API branch reads full history and runs
`computeChannelStats` (an O(n) group+reduce over all history) **twice** — once on
the cache-hit path (`background/index.ts:408-409`) and again on the live path
(`:481-482`), each time only to `.find` one channel. Not a steady-state hot path
(once per summary), so Low-Med. Recommendation: filter history to the target
channel first, or compute stats for just that channel.

**[Low] Per-nav storage reads in the content script are reasonable but not
deduped.** `maybeStartDirectApiRun` does `chrome.storage.local.get(["settings",
"tldwSummaryCache", AUTO_RUN_CHANNELS_KEY])` (one batched read, good — `:2283`) but
then `startApiCall` re-reads `tldwSummaryCache` again for freshness (`:2336`), and
`readAutoRunChannels` is a separate read (`:2307`). `sponsorblock.ts` and
`watchtime.ts` each independently read `settings` on every nav (`:54-58`,
`:258-268`). Across the three scripts, a single video navigation triggers ~5-6
`storage.local.get` calls. Each is fast, but they're uncoordinated. Theoretical;
fine to leave.

### React (options / popup)

**[Med] Channel list rendered unvirtualized, no page cap.** `ChannelsSection`
renders `visibleAll.map(...)` (`:729`) — every channel card, each containing an
expandable `stats.videos.map(VideoRow)` list (`:449-450`). With
`CHANNEL_STATS_CAP=500` source channels (and "unlimited" history feeding
`computeChannelStats`), this can mount hundreds of cards + their (collapsed but
still in DOM) video rows. `sortedAll`/`visibleAll` are correctly `useMemo`'d
(`:601-627`), so the *compute* is fine — the cost is **DOM nodes**. Recommendation:
paginate (e.g. 50 cards + "Show more") or virtualize. Same applies to
`HistorySection`'s `filtered.map` (`:238`) under unlimited history.

**[Low] `StatsSection` data load is well-structured.** The heavy reads
(`getLifetimeStats`/`getGeminiUsage`/`getHistory`) are behind a `useMemo` promise +
`useEffect` (`:393-407`); `computeChannelStats(history)` runs once per render of the
loaded view (`:441`). Top-N rankings (`topChannelsByTime`, `mostEngagedChannels`)
are O(n log n) over ≤500 channels — trivial. Fine.

**[Low] Popup has zero memoization but also tiny lists.** `App.tsx` has no
`useMemo`/`useCallback` and 6 `.map`s, but the popup renders a handful of
destinations + a short recent-history slice; re-render cost is negligible for a
popup that mounts fresh each open. Not worth changing.

---

## 4. Background service worker (`src/background/index.ts`)

**[Low] Write-lock design is correct; contention is the intended trade-off.**
`withWriteLock` uses the Web Locks API to serialize same-origin RMW
(`storage.ts:114-132`) — necessary because `WATCH_PROGRESS` from every tab funnels
to the one worker. The cost is that concurrent watch-progress writes from multiple
tabs **serialize** on the `tldwStats` and `history` locks; with the per-channel map
this serialized critical section is now slightly longer (see §3). Acceptable, but
it's the place where the new feature most directly taxes the worker. No change
needed beyond the §3 batching suggestion.

**[Low] Per-message overhead is fine; no SW-keepalive smell.** Handlers return
`true` only for genuinely async responses and `sendResponse` on every path
(including error paths, e.g. `:780-784`) so ports don't hang and the worker can
idle out promptly. No `setInterval`/long-timer in the worker keeps it alive
artificially. `flashBadge` uses a 2.5 s `setTimeout` (`:156`) — brief, fine.

**[Low] `startupStorageSweep` is good and cheap.** Runs history-expiry + cache
prune + the one-time `tldwBlockedChannels` cleanup on install/startup
(`:84-107`), bounding storage even for an idle user. (It would be the natural home
for the tag-map orphan sweep from §1.)

**[Low] `getOpenSearches()` calls `chrome.tabs.query({})` to prune.**
(`storage.ts:855`) — queries **all** tabs to drop closed destination tabs. Called
from a few handlers (`AI_SUMMARY`, `OPEN_OR_FOCUS_DESTINATION`). Infrequent;
list capped at 20. Fine.

---

## 5. Bundle / build

Last build's `dist/assets` (total JS ≈ **380 KB**):

| Chunk | Size | What it actually is |
|---|---|---|
| `DestinationIcon-WN-UQo-N.js` | **146 KB** | **The shared React + ReactDOM vendor bundle** (+ the modulepreload bootstrap), *not* the icon. crxjs named the shared chunk after one of its members. Both popup and options import it (`dist/src/*/index.html`), so **React is shared, not duplicated** — good. |
| `index.html-dv0vg_oP.js` | 98 KB | Options app code (8 sections + components). |
| `youtube.ts-BNlBf1Zq.js` | 40 KB | The on-page widget content script. **No React** (confirmed). |
| `storage-C_mVtT2i.js` | 16 KB | Shared storage lib. |
| `index.ts-BdeQRcnm.js` | 14 KB | Injector (`inject.ts`). |
| `index.html-C4RH6l9f.js` | 10 KB | Popup app code. |
| `claude-icon-B5g2T9Nx.png` | **167 KB** (asset, not JS) | The Claude brand PNG, loaded for a 28px `<img>` (`DestinationIcon.tsx:1,46-52`). |

**[Med] The 167 KB `claude-icon.png` is the real avoidable weight.** It's a raw
PNG served at 28-32px (`DestinationIcon.tsx`), so it's ~99% wasted bytes. Loaded by
the popup and options (anywhere `DestinationIcon` renders the Claude case).
Recommendation: downscale to ~64px and convert to WebP (likely **2-4 KB**), or
replace with an inline SVG like the other three destinations (Gemini/ChatGPT/
NotebookLM are already inline SVG paths — Claude is the lone `<img>`). This also
removes the one bundled raster brand logo (the handoff's IP-de-risk note, §C).

**[Low] The 146 KB React vendor chunk is the floor for a React popup+options.**
Not duplicated, already code-split. Could be trimmed with Preact/compat if popup
size ever matters, but it's a one-time download cached by Chrome; low priority.

**[Low] Content scripts are lean.** `youtube.ts` (40 KB) pulls no React and only
small lib helpers; `sponsorblock`/`watchtime`/`intercept` are 1-3 KB each. The
always-on YouTube injection cost is small.

---

## Real-risk vs theoretical — summary

| Finding | Verdict |
|---|---|
| `tldwChannelTags`/`tldwVideoTags` unbounded (§1) | **Real** (slow, multi-year power-tagger) — only true unbounded vector |
| 500ms poll perpetual idle CPU (§2) | **Real but small** — perpetual, multiplied per tab; cheap to throttle |
| Watch-time double-RMW + per-channel write cost (§3) | **Real but modest** — hottest write path, grows with channel count |
| Unvirtualized channel/history lists (§4 React) | **Real only at "unlimited" + heavy use** — DOM bloat, not a crash |
| `claude-icon.png` 167 KB (§5) | **Real, trivial fix** — wasted bytes |
| `videosWatched` over-count | **Real but minor** — fix via history-window dedup, NOT a stored ID set |
| Quota at risk for heavy user | **Theoretical** today (~1.2 MB) — becomes real only if tag maps + "unlimited" history go unbounded |
| Write-lock contention, SW keepalive, interceptor retention | **Theoretical / non-issues** — design is sound |
