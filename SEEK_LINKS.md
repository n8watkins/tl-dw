# TL;DW — Clickable Seek Links (design outline)

_Status: v1 shipped 2026-06-06 (v0.1.38). Phases 1–3 done; progress-bar markers
(phase 4) and smarter moment sources (phase 5) remain. Drafted 2026-06-06._

**v1 decisions taken:** moment source **(b) transcript-derived**; placement **side
panel in `#secondary`**; trigger **on-demand from the popup** ("Key moments on
video"). Markers and model/API-authored moments are deferred per the phasing below._

The one big remaining feature from NEXT_STEPS.md. Goal: turn key moments into
links that jump the YouTube player to that timestamp — and, the part that makes
it distinctive, render those moments **on the YouTube page itself** as a
clickable chapter-style overlay.

---

## 1. User story

> I summarized a 40-minute talk. Instead of scrubbing, I see a list of its key
> moments next to the video — "06:12 — the actual benchmark numbers",
> "23:40 — the counter-argument" — and clicking one jumps the player straight
> there.

Two surfaces, increasing ambition:

- **A. In-answer links** (cheap): timestamps in the model's reply (in the
  Gemini/ChatGPT tab) become clickable; clicking seeks the YouTube tab.
- **B. On-YouTube overlay** (the big aspect): a moments panel + progress-bar
  markers injected into the watch page, independent of where the answer lives.

This doc centers **B** since that's what you asked for, but they share the
back half (the seek mechanism).

---

## 2. The core tension to decide first

The summary is generated **in the destination tab** (gemini.google.com, etc.),
and TL;DW's current privacy promise is explicit: _we never read or store the
model's response_ (PLAN.md §7). The on-YouTube overlay needs moments data **in
the YouTube tab**. So the moments have to come from somewhere that isn't
"scrape the model's rendered answer," or that promise changes.

Three sources for the moments, best-fit first:

| Source | How | Quality | Privacy | Effort |
|--------|-----|---------|---------|--------|
| **(c) API JSON** | A BYO-key call (Gemini/Anthropic) that returns a structured `moments[]` JSON from the timestamped transcript | High + structured | Clean (we own the call) | High (key mgmt, the V2 "API mode") |
| **(b) Transcript-derived** | We pick moments ourselves from the timestamped transcript (segmentation + simple ranking), no model | Medium | Clean (never touches the answer) | Medium |
| **(a) Answer-scraped** | A content script reads the rendered reply, parses a `MOMENTS` block we asked the prompt to emit | High | **Breaks the "never read the response" stance** — needs explicit opt-in + a privacy-note change | Medium |

**Recommendation:** ship the overlay on **(b)** first — it's privacy-clean,
needs no key, and proves the hard YouTube-side UI. Offer **(a)** or **(c)**
later as an opt-in "smarter moments" upgrade. (a) is tempting because the model
is better at "what matters," but crossing the response-reading line should be a
deliberate, opted-in choice, not the default.

---

## 3. Prerequisite: stop throwing away transcript timestamps

Today the transcript pipeline **discards** timing on purpose:

- `extractFromTimedText` joins only the `utf8` text and drops `tStartMs` /
  `<text start=…>`.
- `stripTimestamp` removes the leading `1:23` from each DOM segment.

For any of the three sources we need a **timestamped transcript**: an array of
`{ startSeconds, text }`. This is a contained change — the timing is already in
the data we parse; we just keep it. Produce a `getTimedTranscript()` alongside
the existing flat `getTranscript()` so nothing else changes.

This single change unblocks all three moment sources and is the right first
commit.

---

## 4. The YouTube overlay (the big aspect)

### 4.1 What to inject

Two complementary UI pieces, both in the YouTube content script:

1. **Moments panel** — a list rendered into the secondary column
   (`#secondary` / `#secondary-inner`, where related videos live) or directly
   under the player in `#primary`. Each row: `mm:ss` + one-line label, click →
   seek. Styled to read as "TL;DW chapters."
2. **Progress-bar markers** — small ticks overlaid on `.ytp-progress-bar` at
   `left = startSeconds / durationSeconds * barWidth`. Hover shows the label;
   click seeks. This is the "wow" piece and the fiddly one.

Panel first (robust, easy), markers second (higher polish, more maintenance).

### 4.2 Seeking — how the click actually moves the video

- **Simple path (isolated world):** set `video.currentTime = startSeconds` on
  the `<video>` element we already grab in `getVideoMeta`, then `video.play()`.
  Works from the content script directly. Downside: doesn't update the URL `&t=`
  or YouTube's own UI state, but the playhead moves correctly.
- **Clean path (MAIN world):** call `document.getElementById("movie_player")
  .seekTo(seconds, true)` — but the player API only exists on the page, not in
  our isolated content script. We already ship a MAIN-world script
  (`youtube-intercept.ts`); route seeks through it via `window.postMessage`
  (isolated → MAIN) so we use YouTube's real API.

Start with the simple path; upgrade to `seekTo` if the UI desync is annoying.

### 4.3 The hard parts (this is where the effort goes)

YouTube is an SPA with a player that survives navigation and a layout that
mutates constantly. The overlay must be defensive:

- **SPA lifecycle.** Watch pages swap content via `yt-navigate-finish` (and
  `yt-page-data-updated`). On each: tear down the old overlay, recompute moments
  for the new video, re-render. On leaving a watch page: remove everything.
- **Late / re-rendered DOM.** `#secondary` and the progress bar mount
  asynchronously and YouTube re-renders them. Anchor with a `MutationObserver`
  that re-attaches the overlay if it gets blown away, rather than a one-shot
  query.
- **Player modes & resize.** Default / theater / fullscreen / mini-player each
  change the bar width and whether `#secondary` is even visible. Markers must
  reposition on resize (`ResizeObserver` on the progress bar) and on mode
  changes (the `ytp-*` class flips on `#movie_player`). In fullscreen the panel
  is gone but bar markers should persist (they live inside the bar).
- **Duration readiness.** Marker positions need a final duration; `video.duration`
  is `NaN` until metadata loads. Reuse the existing fallback to
  `.ytp-time-duration`, and recompute once duration settles.
- **Don't fight YouTube's own chapters.** If the video has native chapters the
  bar is segmented; our ticks should sit visually above without breaking hover
  scrubbing. Pointer-events scoped to the ticks only.
- **Shorts.** No real progress bar / different player — scope the overlay to
  `/watch` and skip Shorts (or panel-only there).

### 4.4 Lifecycle summary

```
yt-navigate-finish
  → is /watch?            no → teardown, stop
  → getTimedTranscript()  (source b: derive moments)
  → render panel into #secondary (observer keeps it attached)
  → once duration known: render ticks on .ytp-progress-bar
  → click → seek(startSeconds)
resize / mode change → reposition ticks
leave /watch → teardown
```

---

## 5. Deriving moments without the model (source b)

A pragmatic v1 ranking over the timestamped transcript:

1. Merge segments into ~15–45s windows.
2. Score windows (length of speech, keyword density vs. the rest, scene/topic
   shifts via simple lexical change). Optionally seed with the video's native
   chapter boundaries when present.
3. Take the top N (cap ~8–12), each with its window start time and a label
   (first salient sentence of the window, trimmed).

This won't match a good LLM's judgment, but it's deterministic, instant, and
keeps the response untouched. The panel framing ("key moments") sets honest
expectations. Swapping in source (a)/(c) later only changes how `moments[]` is
produced — the overlay code is identical.

---

## 6. Risks

- **Overlay maintenance** is the real ongoing cost — same brittleness as the
  inject selectors, now on YouTube's player chrome. The visibility/observer
  discipline from `inject.ts` applies; budget for periodic breakage.
- **Privacy line** — only source (a) crosses it; keep it opt-in if we build it.
- **Moment quality** for source (b) may underwhelm; manage with framing and an
  easy path to the smarter sources.
- **Performance** — observers on a hot page; throttle reposition handlers and
  disconnect on teardown.

---

## 7. Phased build

1. ✅ **`getTimedTranscript()`** — retains `{startSeconds, text}` across all three
   paths (json3 `tStartMs`, XML `start=`, DOM segment timestamps); the flat
   `getTranscript()` is unchanged.
2. ✅ **Seek** — `seekTo()` sets `video.currentTime` directly (MAIN-world
   `player.seekTo` upgrade deferred).
3. ✅ **Moments panel** (source b) prepended into `#secondary-inner`,
   click-to-seek, theme-aware, torn down on `yt-navigate-finish`. Triggered by
   the popup's "Key moments on video" button (`TOGGLE_MOMENTS`).
4. ⬜ **Progress-bar markers** + resize/mode handling. The polish pass.
5. ⬜ **Smarter moments** (opt-in source a, or source c if/when API mode lands).

Stop after any phase and still have something shippable.

---

## 8. Decisions (settled for v1)

- **Moment source:** (b) transcript-derived — privacy-clean, no key. Revisit (a)/(c)
  in phase 5 if label quality disappoints.
- **Overlay placement:** side panel in `#secondary`. Progress-bar markers are phase 4.
- **Trigger:** on-demand from the popup, so we don't fetch transcripts on every
  watch page. Could become automatic later if it proves wanted.
