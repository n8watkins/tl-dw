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

### 3. Daily quota bar
- Progress bar in Direct API settings: today's calls / 500 RPD free tier
- Color-coded: green (<60%), amber (60–90%), red (>90%)
- Link to Google AI pricing page
- Sits above the existing usage stats (total, all-time, last call)

### 4. Channel tracking + comparison
- `channel` and `channelAvatarUrl` stored on every `SearchHistoryEntry`
- Avatar scraped from YouTube DOM: `ytd-video-owner-renderer #avatar img`
- `computeChannelStats()` groups history by channel, computes avg AI rating locally — **no extra API call**
- Before sending `SET_SUMMARY`, background looks up the channel's historical stats
- Widget shows `📊 vs channel` row: avg AI score and ▲/▼/≈ trend (threshold ±0.4)

### 5. Channels page (options)
- New `▦ Channels` nav item in the options sidebar (between History and Settings)
- Channel cards with 44px circular avatar — real img with `onError` → color-hash initial fallback
- AI score pill (green ≥8 / amber 6–7.9 / red <6)
- "Last watched" relative timestamp on each card
- Sort by: Most watched / Highest rated / Recent
- CSS grid accordion: click to expand per-channel video list
- Video rows: clickable title (opens YouTube), AI pill, date
- Header: "N channels tracked · M videos total"
- Empty state for users with no channel data yet

### 6. API call log
- Per-call accordion in Direct API settings showing prompt sent + raw response
- Expandable — collapsed by default

### 7. History management
- Auto-expire entries older than a configurable number of days
- Manual history limit (50 / 100 / 250 / unlimited)
- Clear usage button with confirmation dialog
- Permanent all-time call counter (never reset by clearing)

---

## Known bugs / open threads

### Medium priority

**Avatar URL expiry**  
YouTube avatar URLs embedded in `src` attributes can expire (they're signed CDN URLs). Current mitigation: `onError` falls back to the color-hash initial. But stale URLs sit in storage forever, so every Channels page load will fire broken image requests before falling back.

### Low priority

**Popup has no channel context**  
The options Channels page shows per-channel stats but the popup (shown while browsing YouTube) has no awareness of them. A "You've watched 4 videos from this channel, avg AI 7.2" line in the popup would close that gap.

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

**1 Gemini API call per video:**  
Main transcript analysis — no secondary calls.

Channel comparison is always local arithmetic — no LLM involved.

---

## Not doing

- **Key moments** (timestamps surfaced in widget) — explicitly killed, don't revisit
- **YouTube Data API** — DOM-scraping only

---

## Potential next steps

1. Avatar URL de-duplication / refresh strategy
2. Popup channel context card
3. Chrome Web Store prep (privacy policy, store listing, manifest audit)
