# TL;DW Extension — Status

**Version:** 0.1.94  
**Last updated:** 2026-06-07

---

## What's built

### 1. Core Direct API flow
- Headless Gemini REST call on YouTube navigation — no destination tab opened
- `---TLDW---` block parsed from response: VERDICT / SUMMARY / RATING / DETAILS
- Widget injected into YouTube page with shimmer loading state
- Auto-run trigger: fires when a video exceeds the configured minute threshold
- Source label in widget links back to Direct API settings

### 2. Profile picker for Direct API
- Separate profile selector in Direct API settings (independent of the global default)
- Headless auto-runs resolve this profile first; falls back to global default if unset
- Setting persisted as `settings.directApiProfileId`

### 3. Comment sentiment analysis
- Optional second Gemini call scrapes top 20 comments from the YouTube DOM (`ytd-comment-thread-renderer`)
- Returns a community sentiment paragraph + numeric score (1–10)
- Widget two-phase render: main summary appears first, `💬 Community` row fills in async
- Toggle + editable `commentPromptTemplate` in Direct API settings
- "+1 request" amber badge on the toggle so cost is immediately visible
- Request count summary pill updates live: "1 Gemini request per video" or "2 Gemini requests per video"

### 4. Daily quota bar
- Progress bar in Direct API settings: today's calls / 500 RPD free tier
- Color-coded: green (<60%), amber (60–90%), red (>90%)
- Link to Google AI pricing page
- Sits above the existing usage stats (total, all-time, last call)

### 5. Channel tracking + comparison
- `channel` and `channelAvatarUrl` stored on every `SearchHistoryEntry`
- Avatar scraped from YouTube DOM: `ytd-video-owner-renderer #avatar img`
- `computeChannelStats()` groups history by channel, computes avg AI rating + avg audience score locally — **no extra API call**
- Before sending `SET_SUMMARY`, background looks up the channel's historical stats
- Widget shows `📊 vs channel` row: avg AI score, avg audience score, and ▲/▼/≈ trend (threshold ±0.4)

### 6. Channels page (options)
- New `▦ Channels` nav item in the options sidebar (between History and Settings)
- Channel cards with 44px circular avatar — real img with `onError` → color-hash initial fallback
- AI score pill (green ≥8 / amber 6–7.9 / red <6), audience score pill
- "Last watched" relative timestamp on each card
- Sort by: Most watched / Highest rated / Recent
- CSS grid accordion: click to expand per-channel video list
- Video rows: clickable title (opens YouTube), AI pill, audience pill, date
- Header: "N channels tracked · M videos total"
- Empty state for users with no channel data yet

### 7. API call log
- Per-call accordion in Direct API settings showing prompt sent + raw response
- Expandable — collapsed by default

### 8. History management
- Auto-expire entries older than a configurable number of days
- Manual history limit (50 / 100 / 250 / unlimited)
- Clear usage button with confirmation dialog
- Permanent all-time call counter (never reset by clearing)

---

## Known bugs / open threads

### High priority

**`audienceScore` never written back to `SearchHistoryEntry`**  
Comment sentiment comes in async after `addHistoryEntry` already ran. The score is patched onto `GeminiCallEntry` (call log) but not onto the history entry. This means the Channels page audience averages will always be null even when comment sentiment has run.  
Fix: after the async comment call resolves, patch the matching history entry by id.

### Medium priority

**Comment scraping fragility**  
`ytd-comment-thread-renderer` is an undocumented YouTube DOM selector. YouTube SPA updates can silently break it. There's no retry logic, no graceful error surfacing to the user — the community row just never fills in.

**Avatar URL expiry**  
YouTube avatar URLs embedded in `src` attributes can expire (they're signed CDN URLs). Current mitigation: `onError` falls back to the color-hash initial. But stale URLs sit in storage forever, so every Channels page load will fire broken image requests before falling back.

### Low priority

**Popup has no channel context**  
The options Channels page shows per-channel stats but the popup (shown while browsing YouTube) has no awareness of them. A "You've watched 4 videos from this channel, avg AI 7.2" line in the popup would close that gap.

**No history entry for comment sentiment score**  
Related to the audienceScore bug above — even if we patch history, the audience score only exists when comment sentiment was enabled for that video. Older entries will always have `audienceScore: undefined`.

---

## Architecture notes

| Layer | Key files |
|---|---|
| Types | `src/types/index.ts` |
| Background orchestrator | `src/background/index.ts` |
| Content script (YouTube DOM) | `src/content/youtube.ts` |
| History helpers | `src/lib/history.ts` |
| Storage helpers | `src/lib/storage.ts` |
| Options UI | `src/options/sections/` |

**Max 2 Gemini API calls per video:**  
1. Main transcript analysis (always)  
2. Comment sentiment (optional, toggled in settings)

Channel comparison is always local arithmetic — no LLM involved.

---

## Not doing

- **Key moments** (timestamps surfaced in widget) — explicitly killed, don't revisit
- **YouTube Data API** — comments are DOM-scraped only

---

## Potential next steps

1. Fix `audienceScore` patching back to history (enables real Channels page audience averages)
2. Comment scraping resilience (selector fallbacks, user-visible error when comments unavailable)
3. Avatar URL de-duplication / refresh strategy
4. Popup channel context card
5. Chrome Web Store prep (privacy policy, store listing, manifest audit)
