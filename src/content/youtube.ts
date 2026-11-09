/**
 * Runs on youtube.com (isolated world) and acts only on watch pages. It obtains
 * the current video's transcript and hands it to the background worker on
 * request. YouTube Shorts are out of scope: on a Short this script reads
 * nothing, clicks nothing and mounts nothing.
 *
 * Primary path: the MAIN-world interceptor (youtube-intercept.ts) wraps the
 * page's fetch and relays YouTube's own transcript responses here via
 * postMessage. We cache that. To make YouTube actually issue the request we
 * open its "Show transcript" panel, but we read the intercepted *data*, not
 * the rendered panel, so it survives UI redesigns, shadow DOM, virtualization,
 * and other extensions mutating the panel.
 *
 * Fallback path: if nothing is intercepted, we scrape whatever the panel
 * rendered (classic or modern markup), reading only each segment's text.
 *
 * Only the currently-loaded video is visible here, so a right-clicked thumbnail
 * gets no transcript; the background worker handles that.
 */

import {
  extractFromGetPanel,
  extractFromGetTranscript,
  extractFromTimedText,
  stripSegmentTimeLabels,
  type TranscriptRead,
} from "../lib/youtubeTranscript";
import { createKeyedSingleFlight } from "../lib/singleFlight";
import { autoRunNote, usesOwnKey } from "../lib/autoRunNote";
import { cachedSourceLabel, type SummarySourceKind } from "../lib/summarySource";
import type { CachedSummary, PromptProfile, SponsorWindowApi, TldwSummary as SharedSummary, VideoMeta } from "../types";
import {
  focusRing,
  icon,
  type MenuEntry,
  overflowMenu,
  panelHeader,
  type PanelTheme,
  panelTheme,
  pillButton,
  plainMarkdown,
  sourceLine,
  summaryBody,
} from "./panelUi";
import { formatClock, parseClock } from "../lib/timedTranscript";
import { geminiModelLabel } from "../lib/constants";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log("[TL;DW]", ...args);

/** The watch-page video id, or null anywhere else (Shorts, home, search...). */
const currentVideoId = (): string | null =>
  location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") || null : null;

/**
 * Whether the page has caught up with the URL. On an in-page navigation the
 * URL names the new video at once, but YouTube re-renders the heading, channel
 * row and transcript panel up to a second later; until `ytd-watch-flexy`
 * carries the new id, what's on screen still belongs to the previous video.
 */
function pageShowsCurrentVideo(): boolean {
  const vid = currentVideoId();
  if (!vid) return false;
  const shown = document.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
  return !shown || shown === vid;
}

/**
 * Whether the description (and the "Show transcript" button inside it) has
 * re-rendered for the video in the URL. `ytd-watch-metadata` carries the id of
 * the video its description belongs to; it can lag `ytd-watch-flexy`, and until
 * it catches up the button on screen opens the PREVIOUS video's transcript.
 */
function descriptionShowsCurrentVideo(): boolean {
  const vid = currentVideoId();
  if (!vid || !pageShowsCurrentVideo()) return false;
  const shown = document.querySelector("ytd-watch-metadata")?.getAttribute("video-id");
  return !shown || shown === vid;
}

// --- the page's own player data (via the MAIN-world bridge) ----------------

type PlayerInfo = {
  videoId: string;
  /** The content video's length, even while a pre-roll ad plays. */
  lengthSeconds: number;
  isLive: boolean;
  /** No caption tracks means YouTube has no transcript for this video. */
  hasCaptions: boolean;
  /** YouTube's playability status: "OK" when the video plays. */
  playability?: string;
  /** Neither private nor unlisted: the Gemini API can watch it from the link. */
  isPublic?: boolean;
};

/**
 * YouTube's player response, read through youtube-intercept.ts (the player API
 * lives in the page's world), for whichever video the player holds. Null when
 * the bridge or the player isn't there.
 */
function playerInfo(): PlayerInfo | null {
  const reply: { info: PlayerInfo | null } = { info: null };
  const onReply = (event: Event) => {
    try {
      reply.info = JSON.parse(String((event as CustomEvent).detail)) as PlayerInfo | null;
    } catch {
      reply.info = null;
    }
  };
  document.addEventListener("tldw:player-info", onReply);
  try {
    document.dispatchEvent(new CustomEvent("tldw:player-info-request"));
  } finally {
    document.removeEventListener("tldw:player-info", onReply);
  }
  return reply.info;
}

/**
 * The player response for the video in the URL. Null when there is none, or
 * the player still holds another video (right after an in-page navigation).
 */
function playerInfoForCurrentVideo(): PlayerInfo | null {
  const vid = currentVideoId();
  if (!vid) return null;
  const info = playerInfo();
  return info && info.videoId === vid ? info : null;
}

/** Whether the player is showing an ad (its <video> and clock are the ad's). */
function adShowing(): boolean {
  return !!document.getElementById("movie_player")?.classList.contains("ad-showing");
}

// --- intercepted transcript cache ----------------------------------------

let captured: TranscriptRead | null = null;
let capturedVideoId: string | null = null;
// Transcript-panel responses seen so far, and the video the latest was for.
let panelResponseSeq = 0;
// The HTTP status when the latest of those responses was an error, else null.
let lastPanelResponseFailed: number | null = null;
let lastPanelResponseVideoId: string | null = null;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as
    | { __tldw?: boolean; kind?: string; body?: unknown; videoId?: string; failedStatus?: number }
    | undefined;
  if (!data || data.__tldw !== true) return;

  // Tag with the id the interceptor captured when the request was ISSUED (or,
  // for get_panel, the id inside the response), not the current URL: a late
  // response for the previous video must not be served as the current one's
  // transcript after an SPA navigation.
  let text: TranscriptRead | null = null;
  let videoId = typeof data.videoId === "string" && data.videoId ? data.videoId : null;
  if (data.kind === "get_panel") {
    const panel = extractFromGetPanel(data.body);
    text = panel ? { text: panel.text, segments: panel.segments } : null;
    if (panel?.videoId) videoId = panel.videoId;
  } else if (data.kind === "get_transcript") {
    text = extractFromGetTranscript(data.body);
  } else if (data.kind === "timedtext") {
    text = extractFromTimedText(data.body);
  }

  // Count every transcript-panel response, whichever video it is for, so a
  // fetch can tell "YouTube answered for another video" from "no answer yet".
  if (videoId && (data.kind === "get_panel" || data.kind === "get_transcript")) {
    panelResponseSeq++;
    lastPanelResponseVideoId = videoId;
    lastPanelResponseFailed = typeof data.failedStatus === "number" ? data.failedStatus : null;
    if (lastPanelResponseFailed !== null) {
      log("YouTube couldn't load the transcript for", videoId, "(HTTP", `${lastPanelResponseFailed})`);
    }
  }

  if (text && videoId) {
    captured = text;
    capturedVideoId = videoId;
    log("intercepted transcript:", text.text.length, "chars", videoId === currentVideoId() ? "" : `(for ${videoId}, not this video)`);
  }
});

function cachedForCurrentVideo(): TranscriptRead | null {
  return captured && capturedVideoId === currentVideoId() ? captured : null;
}

// --- opening the panel (to trigger YouTube's fetch) ----------------------

/**
 * Expand the video description so its "Show transcript" button becomes
 * reachable. Returns whether we actually clicked a visible #expand control, so
 * the caller can collapse it again afterward and leave the page as it found it.
 */
function expandDescription(): boolean {
  const expand = document.querySelector<HTMLElement>(
    "ytd-text-inline-expander #expand, tp-yt-paper-button#expand, #description #expand, #expand",
  );
  if (expand && expand.offsetParent !== null) {
    expand.click();
    return true;
  }
  return false;
}

/** Collapse the description again — undoes a prior expandDescription() click. */
function collapseDescription(): void {
  document
    .querySelector<HTMLElement>(
      "ytd-text-inline-expander #collapse, tp-yt-paper-button#collapse, #description #collapse, #collapse",
    )
    ?.click();
}

/**
 * YouTube's "Show transcript" button, skipping any copy YouTube has hidden (the
 * previous video's description lingers, hidden, for a beat after an in-page
 * navigation). Callers that will CLICK it use transcriptButtonForCurrentVideo.
 */
function findShowTranscriptButton(): HTMLElement | null {
  const usable = (el: HTMLElement | null | undefined): el is HTMLElement =>
    !!el && !el.closest("[hidden]");
  for (const section of document.querySelectorAll(
    "ytd-video-description-transcript-section-renderer",
  )) {
    const sectionBtn = section.querySelector<HTMLElement>("button");
    if (usable(sectionBtn)) return sectionBtn;
  }

  for (const el of document.querySelectorAll<HTMLElement>("button[aria-label]")) {
    if (/transcript/i.test(el.getAttribute("aria-label") ?? "") && usable(el)) return el;
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    "button, ytd-button-renderer, tp-yt-paper-button, yt-button-shape",
  )) {
    if (/^show transcript$/i.test(el.textContent?.trim() ?? "") && usable(el)) return el;
  }
  return null;
}

/**
 * The "Show transcript" button, but only once the description has re-rendered
 * for the video in the URL: clicking a stale button would load the previous
 * video's transcript.
 */
function transcriptButtonForCurrentVideo(): HTMLElement | null {
  return descriptionShowsCurrentVideo() ? findShowTranscriptButton() : null;
}

// --- DOM scrape fallback --------------------------------------------------

// A segment's spoken-text element: the modern panel's attributed string, or the
// classic panel's .segment-text.
const SEGMENT_TEXT_SELECTOR =
  ".segment-text, .ytAttributedStringHost, [role='text']";
// Time labels inside a segment: the visible clock and its screen-reader label
// ("18 seconds"), modern and classic.
const SEGMENT_TIME_SELECTOR =
  "[class*='Timestamp'], [class*='timestamp'], .segment-timestamp";

/**
 * The spoken text of one rendered segment, without its time labels. Reads the
 * segment's own text element; failing that, drops the time-label elements from
 * a copy and strips any leading time labels left in the text.
 */
function segmentText(segment: Element): string {
  const own = segment.querySelector(SEGMENT_TEXT_SELECTOR);
  if (own) return (own.textContent ?? "").replace(/\s+/g, " ").trim();
  const copy = segment.cloneNode(true) as Element;
  copy.querySelectorAll(SEGMENT_TIME_SELECTOR).forEach((el) => el.remove());
  return stripSegmentTimeLabels(copy.textContent ?? "");
}

function scrapeRenderedTranscript(): TranscriptRead | null {
  // Right after an in-page navigation the panel may still hold the previous
  // video's segments; never read it until the description shows the current video.
  if (!descriptionShowsCurrentVideo()) return null;
  for (const selector of [
    // Modern view-model panel: the whole transcript renders at once.
    "transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost",
    // Classic discrete segment elements.
    "ytd-transcript-segment-renderer",
    "ytd-transcript-segment-list-renderer .segment",
  ]) {
    const segments = [...document.querySelectorAll(selector)]
      .map((el) => ({
        // The line's visible clock ("2:36"); NaN when it has none.
        start: parseClock(el.querySelector(SEGMENT_TIME_SELECTOR)?.textContent) ?? NaN,
        text: segmentText(el),
      }))
      .filter((seg) => seg.text);
    if (segments.length === 0) continue;
    const text = segments.map((seg) => seg.text).join(" ");
    if (text) return { text, segments };
  }
  return null;
}

// --- request handling -----------------------------------------------------

/** Either source: intercepted network data, or the rendered panel. */
function available(): TranscriptRead | null {
  return cachedForCurrentVideo() ?? scrapeRenderedTranscript();
}

// YouTube's side panels (transcript, comments, chapters...) are all
// engagement panels. Which one shows the transcript keeps changing: the old
// `engagement-panel-searchable-transcript` panel still exists but stays hidden,
// while "Show transcript" expands `PAmodern_transcript_view`, or the "In this
// video" panel, which has no target-id at all (seen 2026-11-02).
const ENGAGEMENT_PANEL = "ytd-engagement-panel-section-list-renderer";
const PANEL_EXPANDED = "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
const TRANSCRIPT_SEGMENT =
  "transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost, ytd-transcript-segment-renderer";

function expandedPanels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(ENGAGEMENT_PANEL)]
    .filter((panel) => panel.getAttribute("visibility") === PANEL_EXPANDED);
}

/** Whether an engagement panel is (or holds) a transcript. */
function isTranscriptPanel(panel: HTMLElement): boolean {
  return /transcript/i.test(panel.getAttribute("target-id") ?? "") || !!panel.querySelector(TRANSCRIPT_SEGMENT);
}

/** Whether a transcript panel is open on the page. */
function transcriptPanelOpen(): boolean {
  if (expandedPanels().some(isTranscriptPanel)) return true;
  // A page without engagement panels: rendered segments mean it's showing.
  if (document.querySelector(ENGAGEMENT_PANEL)) return false;
  const seg = document.querySelector<HTMLElement>(TRANSCRIPT_SEGMENT);
  return !!(seg && seg.offsetParent !== null);
}

/** How long to wait for the panel our click opened to show up, to close it. */
const PANEL_CLOSE_WAIT_MS = 2000;

/**
 * Close the panel our "Show transcript" click opened: one expanded now that
 * wasn't before the click. A panel that was already open (the user's) is left
 * alone, even when the click switched it to the transcript. The panel can
 * expand a moment after the transcript response arrives, so wait briefly.
 */
async function closePanelOpenedSince(openBefore: Set<HTMLElement>, vid: string): Promise<void> {
  const deadline = Date.now() + PANEL_CLOSE_WAIT_MS;
  for (;;) {
    if (currentVideoId() !== vid) return;
    const opened = expandedPanels().filter((panel) => !openBefore.has(panel));
    const panel = opened.find(isTranscriptPanel) ?? opened[0];
    if (panel) {
      const closeBtn =
        panel.querySelector<HTMLElement>("#visibility-button button") ??
        panel.querySelector<HTMLElement>('button[aria-label*="close" i]');
      if (closeBtn) {
        log("closing the transcript panel TL;DW opened");
        closeBtn.click();
      } else {
        log("couldn't find the close button of the transcript panel TL;DW opened");
      }
      return;
    }
    if (Date.now() >= deadline) return;
    await sleep(100);
  }
}

/** How long to wait for the page to catch up with the URL after a navigation. */
const PAGE_CATCH_UP_MS = 4000;
/** Grace for the "Show transcript" button to render once the description has. */
const BUTTON_GRACE_WITH_CAPTIONS_MS = 3000;
const BUTTON_GRACE_UNKNOWN_MS = 1000;
/** How long to wait for YouTube's transcript response after opening the panel. */
const RESPONSE_TIMEOUT_MS = 10000;
/** Scrape the rendered panel only after the network response had this long to arrive. */
const SCRAPE_AFTER_MS = 2000;

/** Wait for the button that opens THIS video's transcript, or null. */
async function waitForTranscriptButton(vid: string): Promise<HTMLElement | null> {
  const catchUp = Date.now() + PAGE_CATCH_UP_MS;
  while (!descriptionShowsCurrentVideo() && Date.now() < catchUp) {
    await sleep(150);
    if (currentVideoId() !== vid) return null;
  }
  if (!descriptionShowsCurrentVideo()) {
    log("page never caught up with the URL; no transcript");
    return null;
  }
  const info = playerInfoForCurrentVideo();
  if (info && !info.hasCaptions) {
    log("this video has no captions, so no transcript");
    return null;
  }
  // The section renders with the description, so a short grace is enough; no
  // button by then means YouTube offers no transcript for this video.
  const grace = Date.now() + (info?.hasCaptions ? BUTTON_GRACE_WITH_CAPTIONS_MS : BUTTON_GRACE_UNKNOWN_MS);
  for (;;) {
    const button = transcriptButtonForCurrentVideo();
    if (button || Date.now() >= grace || currentVideoId() !== vid) return button;
    await sleep(150);
  }
}

/** How long to wait for the transcript panel TL;DW asks YouTube for itself. */
const DIRECT_PANEL_TIMEOUT_MS = 8000;
/** How long the relayed transcript may trail the bridge's "done" event. */
const RELAY_GRACE_MS = 1500;

/**
 * Ask YouTube for this video's modern transcript panel directly (through the
 * MAIN-world bridge in youtube-intercept.ts), without touching the page. Its
 * response is relayed like YouTube's own, so this resolves to the captured
 * transcript, or null when YouTube had none or the page can't make the request
 * (then TL;DW opens the panel as before).
 */
function requestTranscriptPanel(vid: string): Promise<TranscriptRead | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener("tldw:transcript-panel-done", onDone);
      window.clearTimeout(timer);
      resolve(currentVideoId() === vid ? cachedForCurrentVideo() : null);
    };
    const onDone = (event: Event) => {
      let detail: { videoId?: string; ok?: boolean } = {};
      try {
        detail = JSON.parse(String((event as CustomEvent<unknown>).detail)) as typeof detail;
      } catch { /* not ours */ }
      if (detail.videoId !== vid) return;
      if (!detail.ok) { finish(); return; }
      // The transcript itself arrives by postMessage, a moment after this
      // synchronous event: wait for it briefly.
      const until = Date.now() + RELAY_GRACE_MS;
      const poll = () => {
        if (settled) return;
        if (cachedForCurrentVideo() || Date.now() >= until || currentVideoId() !== vid) finish();
        else window.setTimeout(poll, 50);
      };
      poll();
    };
    const timer = window.setTimeout(finish, DIRECT_PANEL_TIMEOUT_MS);
    document.addEventListener("tldw:transcript-panel-done", onDone);
    document.dispatchEvent(new CustomEvent("tldw:transcript-panel-request", { detail: vid }));
  });
}

/**
 * Fetch the transcript for `vid`: first by asking YouTube for its transcript
 * panel directly, then by opening YouTube's panel, or null.
 */
async function fetchTranscript(vid: string): Promise<TranscriptRead | null> {
  const info = playerInfoForCurrentVideo();
  if (!info || info.hasCaptions) {
    const direct = await requestTranscriptPanel(vid);
    if (direct) {
      log("transcript fetched from YouTube's transcript panel:", direct.text.length, "chars");
      return direct;
    }
    if (currentVideoId() !== vid) return null;
  }
  const button = await waitForTranscriptButton(vid);
  if (!button || currentVideoId() !== vid) {
    log("no 'Show transcript' button for this video");
    return null;
  }
  // A transcript may have arrived meanwhile (the user opened the panel).
  const early = cachedForCurrentVideo();
  if (early) return early;

  // Leave the page as we found it: collapse the panel AND the description if
  // *we* opened/expanded them. A panel/description the user already had open
  // is left untouched. Skip the restore entirely if the user navigated away
  // mid-fetch, or we'd click the NEW video's controls.
  const openedByUs = !transcriptPanelOpen();
  const expandedByUs = openedByUs && expandDescription();
  const panelsOpenBefore = new Set(expandedPanels());
  const seqAtClick = panelResponseSeq;
  const clickedAt = Date.now();
  if (openedByUs) {
    log("opening transcript panel");
    // Expanding can re-render the description, so look the button up again.
    (transcriptButtonForCurrentVideo() ?? button).click();
  }
  const restore = () => {
    if (currentVideoId() !== vid) return;
    if (openedByUs) void closePanelOpenedSince(panelsOpenBefore, vid);
    if (expandedByUs) collapseDescription();
  };

  while (Date.now() - clickedAt < RESPONSE_TIMEOUT_MS) {
    await sleep(250);
    if (currentVideoId() !== vid) return null;
    const hit = cachedForCurrentVideo();
    if (hit) {
      restore();
      log("transcript captured:", hit.text.length, "chars");
      return hit;
    }
    const answered = panelResponseSeq !== seqAtClick;
    if (answered && lastPanelResponseVideoId !== vid) {
      // YouTube answered with another video's transcript: the button belonged to
      // the previous video. Whatever the panel shows now is that transcript, so
      // read nothing and treat this video as having none.
      restore();
      log("transcript response was for", lastPanelResponseVideoId, "not", vid, "- no transcript");
      return null;
    }
    // YouTube's own request for this video's transcript failed, so its panel
    // has nothing to show either: stop waiting (unless the panel already holds
    // segments) instead of running out the clock.
    if (answered && lastPanelResponseVideoId === vid && lastPanelResponseFailed !== null) {
      const scraped = scrapeRenderedTranscript();
      restore();
      if (scraped) {
        log("transcript scraped from the panel:", scraped.text.length, "chars");
        return scraped;
      }
      log("YouTube didn't provide a transcript for this video");
      return null;
    }
    // Fallback for when the network response can't be read: scrape the panel,
    // but only when no response arrived, or the one that did was for this video
    // and couldn't be parsed (then the panel shows this video too). A response
    // for another video returned above, so its transcript is never scraped.
    if (Date.now() - clickedAt >= SCRAPE_AFTER_MS && (!answered || lastPanelResponseVideoId === vid)) {
      const scraped = scrapeRenderedTranscript();
      if (scraped) {
        restore();
        log("transcript scraped from the panel:", scraped.text.length, "chars");
        return scraped;
      }
    }
  }
  restore();
  log("no transcript captured");
  return null;
}

// One panel-open attempt per video at a time. Keyed by video id, so a slow
// fetch for the previous video can't hand its result (or its cleanup) to the
// next one.
const transcriptFlight = createKeyedSingleFlight<TranscriptRead | null>();

async function getTranscript(): Promise<TranscriptRead | null> {
  // Watch pages only: on a Short (or any other page) there is nothing to read,
  // and we must not click anything on it.
  const vid = currentVideoId();
  if (!vid) return null;
  const immediate = available();
  if (immediate) {
    log("transcript ready:", immediate.text.length, "chars");
    return immediate;
  }
  return transcriptFlight.run(vid, () => fetchTranscript(vid));
}

/** Parse "12:34" / "1:02:03" into seconds. */
function hmsToSeconds(text: string | null | undefined): number {
  if (!text) return 0;
  const parts = text.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Whether the broadcast is happening RIGHT NOW (as opposed to a finished live
 * stream, which becomes an ordinary VOD with a transcript), or null while that
 * can't be told. The player response says so directly, even while a pre-roll ad
 * plays; while the player still holds the previous video, its answer (and its
 * badge and duration) belong to that video, so the answer waits for a later
 * check. Without a player response, fall back to the player's red "LIVE" badge
 * (shown only while the stream is ongoing) and the infinite media duration of
 * non-DVR live, neither of which is readable during an ad.
 */
function activelyLive(): boolean | null {
  const info = playerInfo();
  if (info) return info.videoId === currentVideoId() ? info.isLive : null;
  if (adShowing()) return null;
  const badge = document.querySelector<HTMLElement>(".ytp-live-badge");
  if (badge && badge.offsetParent !== null && !badge.closest("[hidden]")) return true;
  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
  if (video && video.duration === Infinity) return true;
  return false;
}

/**
 * Cheap, synchronous check for whether a transcript exists for this video:
 * our fetch-interceptor already captured one, the player lists caption tracks,
 * or YouTube offers its "Show transcript" affordance for this video. Recorded
 * live streams have transcripts; an in-progress broadcast does not. We never
 * pull the full transcript just to answer this.
 */
function transcriptLikelyAvailable(): boolean {
  if (cachedForCurrentVideo()) return true;
  const info = playerInfoForCurrentVideo();
  if (info) return info.hasCaptions;
  return !!transcriptButtonForCurrentVideo();
}

/**
 * Suppress the summary UI only when the stream is live AND we can't find a
 * transcript, so a finished/recorded live stream (transcript present) is still
 * summarizable, while a genuinely in-progress broadcast is not.
 */
function isUnsummarizableLive(): boolean {
  return activelyLive() === true && !transcriptLikelyAvailable();
}

/**
 * Whether YouTube shows "Video unavailable" (removed, private, blocked) or
 * otherwise won't play this video here (age check, upcoming premiere): there
 * is nothing to summarize, so TL;DW offers no button.
 */
function videoUnavailable(): boolean {
  if (!pageShowsCurrentVideo()) return false;
  const info = playerInfoForCurrentVideo();
  if (info?.playability && info.playability !== "OK") return true;
  if (document.querySelector("ytd-watch-flexy")?.hasAttribute("player-unavailable")) return true;
  const error = document.querySelector<HTMLElement>("#error-screen yt-playability-error-supported-renderers");
  return !!error && error.offsetParent !== null && !error.hidden && !!error.textContent?.trim();
}

/** Whether TL;DW has nothing to offer on this video: a live broadcast without a transcript, or an unavailable video. */
function unsummarizable(): boolean {
  return isUnsummarizableLive() || videoUnavailable();
}

/** Whether it is known for sure that this video can be summarized after all. */
function knownSummarizable(): boolean {
  if (videoUnavailable()) return false;
  const live = activelyLive();
  return live === false || (live === true && transcriptLikelyAvailable());
}

/** Clean YouTube's tab title: drop an unread "(3) " prefix and " - YouTube". */
function cleanDocumentTitle(raw: string): string {
  return raw.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube\s*$/, "").trim();
}

/**
 * Metadata for the video in the URL, for the background worker. `current` is
 * false while the page still shows the previous video after an in-page
 * navigation; the worker polls until it turns true.
 */
function getCurrentVideoMeta(): VideoMeta {
  const videoId = currentVideoId();
  // The heading and channel row live in ytd-watch-metadata, which can lag.
  if (!videoId || !descriptionShowsCurrentVideo()) {
    return { videoId, current: false, durationSeconds: 0, channel: "" };
  }
  const heading = document.querySelector("ytd-watch-metadata h1")?.textContent?.trim();
  const title = heading || cleanDocumentTitle(document.title) || undefined;
  const info = playerInfoForCurrentVideo();
  const watchable = info ? info.isPublic !== false && (info.playability ?? "OK") === "OK" : undefined;
  return {
    videoId,
    current: true,
    title,
    live: isUnsummarizableLive(),
    unavailable: videoUnavailable(),
    watchable,
    hasCaptions: info?.hasCaptions,
    ...getVideoMeta(),
  };
}

/**
 * The content video's length in seconds, or 0 while it can't be known. The
 * player response has the real length even during a pre-roll ad; without it, the
 * <video> element and the player clock are trusted only when no ad is showing
 * (during an ad they report the ad's length).
 */
function contentDurationSeconds(): number {
  const info = playerInfoForCurrentVideo();
  if (info?.lengthSeconds) return info.lengthSeconds;
  if (adShowing()) return 0;
  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
  const fromVideo = video && Number.isFinite(video.duration) ? video.duration : 0;
  return fromVideo || hmsToSeconds(document.querySelector(".ytp-time-duration")?.textContent);
}

/** Read the current video's duration (seconds), channel name, and channel avatar URL. */
function getVideoMeta(): { durationSeconds: number; channel: string; channelId?: string; avatarUrl?: string } {
  const durationSeconds = contentDurationSeconds();
  // Channel name, id/href (the key the tag row writes under, so the background
  // can resolve channel tags by id) and avatar. getChannelInfo skips the empty
  // avatar link that precedes the name link in the owner row.
  const info = getChannelInfo();
  return {
    durationSeconds,
    channel: info?.name ?? "",
    channelId: info?.id,
    avatarUrl: info?.avatarUrl || undefined,
  };
}

// --- auto-run channel helpers (direct storage; no lib imports in content script) --

const AUTO_RUN_CHANNELS_KEY = "autoRunChannels";

type AutoRunChannelEntry = {
  id: string; name: string; avatarUrl: string; addedAt: string;
  autoRunSummary: boolean;
};

async function readAutoRunChannels(): Promise<AutoRunChannelEntry[]> {
  const r = await chrome.storage.local.get(AUTO_RUN_CHANNELS_KEY);
  const raw = (r[AUTO_RUN_CHANNELS_KEY] as Partial<AutoRunChannelEntry>[]) ?? [];
  return raw.map((c) => ({ autoRunSummary: true, ...c } as AutoRunChannelEntry));
}

async function writeAutoRunChannel(info: ChannelInfo, enable: boolean): Promise<void> {
  const channels = await readAutoRunChannels();
  const existing = channels.find((c) => c.id === info.id || c.name === info.name);
  let updated: AutoRunChannelEntry[];
  if (existing) {
    if (!enable) {
      updated = channels.filter((c) => c.id !== existing.id);
    } else {
      updated = channels.map((c) =>
        c.id === existing.id ? { ...existing, avatarUrl: info.avatarUrl, autoRunSummary: true } : c,
      );
    }
  } else if (enable) {
    updated = [{
      id: info.id, name: info.name, avatarUrl: info.avatarUrl,
      addedAt: new Date().toISOString(),
      autoRunSummary: true,
    }, ...channels];
  } else {
    updated = channels;
  }
  await chrome.storage.local.set({ [AUTO_RUN_CHANNELS_KEY]: updated });
}

// --- channel info extracted from the page ------------------------------------

type ChannelInfo = { id: string; name: string; avatarUrl: string };

/** Extract channel handle/ID, display name, and avatar from the current watch page. */
function getChannelInfo(): ChannelInfo | null {
  // querySelectorAll returns elements in DOM order. The avatar link appears before the
  // channel-name link and has no text content, so we iterate and skip empty anchors
  // rather than stopping at the first match.
  const candidates = document.querySelectorAll<HTMLAnchorElement>(
    "ytd-video-owner-renderer a[href^='/@'], ytd-video-owner-renderer a[href^='/channel/'], " +
    "ytd-channel-name a[href^='/@'], ytd-channel-name a[href^='/channel/'], " +
    "#owner a[href^='/@'], #owner a[href^='/channel/'], " +
    "ytd-channel-name a, #owner #channel-name a, ytd-video-owner-renderer a.yt-simple-endpoint",
  );
  let anchor: HTMLAnchorElement | null = null;
  let name = "";
  for (const el of candidates) {
    const text = el.textContent?.trim() ?? "";
    if (text) { anchor = el; name = text; break; }
  }
  if (!anchor || !name) return null;
  const href = anchor.getAttribute("href") ?? "";
  const id = href.startsWith("/") ? href : `/@${name}`;
  const avatarUrl =
    document.querySelector<HTMLImageElement>(
      "ytd-video-owner-renderer #avatar img, #owner yt-img-shadow img, ytd-video-owner-renderer yt-img-shadow img",
    )?.src ?? "";
  return { id, name, avatarUrl };
}


// Module-level state so the SET_SUMMARY handler can use the same channel context
// as the initial maybeStartDirectApiRun call.
let currentChannelInfo: ChannelInfo | null = null;
let currentAutoRunSummary = false;
// Whether headless Direct API (free Gemini, no tab) is configured. Drives the
// "Get instant results" CTA shown when it's NOT set up.
let currentDirectApiEnabled = false;

// Incremented on every navigation. Async flows (maybeStartDirectApiRun) capture
// it up front and bail if it changed after an await, so a slow run for the
// previous video never mutates shared state or injects a panel onto the new one
// (LESSONS_LEARNED #9 — "state goes stale after every await").
let navEpoch = 0;


// --- TL;DW summary panel -------------------------------------------------

/** A summary as the page shows it: what the worker sent, and where it came from. */
type TldwSummary = SharedSummary & {
  /** A one-off line under the summary (the model fallback notice). */
  fallbackNote?: string;
  source?: string;
  sourceKind?: SummarySourceKind;
};

/** A panel that may carry a teardown fn (e.g. removing a document listener),
 *  invoked by removeSummaryPanel so we don't leak listeners across rebuilds. */
type CleanablePanel = HTMLElement & { __tldwCleanup?: () => void };

let summaryPanel: HTMLElement | null = null;
// Which kind of panel is currently injected into the host. Drives the inline
// TL;DW button's resting cue (see ensureWatchButton):
//  - "summary": a real summary panel → button reads "ready".
//  - "idle": the "Get Summary" placeholder (or an error panel) → button "idle".
//  - null: no panel.
// Note: the in-flight ("analyzing") state is NOT a panel kind — there is no
// skeleton panel. The inline TL;DW button is the sole loading indicator; the
// `runInFlight` flag below tracks that state.
let summaryPanelKind: "summary" | "idle" | "progress" | "notice" | null = null;
// The video the injected panel belongs to. YouTube keeps #below across an
// in-page navigation, so a panel outlives its video until TL;DW notices the
// change: nothing may treat it as the current video's panel unless this matches.
let summaryPanelVideoId: string | null = null;

/** Put `panel` on the page as the one TL;DW panel, owned by the current video. */
function mountPanel(host: Element, panel: HTMLElement): void {
  summaryPanel = panel;
  summaryPanelVideoId = currentVideoId();
  host.prepend(panel);
}

/** The panel, only when it belongs to the video in the URL. */
function currentVideoPanel(): HTMLElement | null {
  return summaryPanel && summaryPanelVideoId === currentVideoId() ? summaryPanel : null;
}

// True while a summary run is in flight (request sent, no SET_SUMMARY /
// SET_SUMMARY_ERROR / timeout yet). The inline TL;DW button shows the
// "Analyzing…" cue; this flag — not a panel kind — gates the loading timeout and
// the SET_SUMMARY_ERROR handler so errors/timeouts still surface even though
// there's no skeleton panel. MUST be cleared on every terminal path (result,
// error, timeout, navigation) so the button never sticks on "Analyzing…".
let runInFlight = false;

// The video whose page run last ran out of time. An answer for it that arrives
// afterwards is still shown, but the worker is told it came late, so it isn't
// cached: the page had given up on it, and a slow answer is often a broken one.
let timedOutVideoId: string | null = null;

// The current "run a summary" action, captured so the loading-timeout error
// panel can offer a one-click Retry. Set whenever a run flow is armed.
let currentSummarizeAction: (() => Promise<void>) | null = null;
// Fires if a run sits unfinished too long (a tab-scrape that never returned, a
// dead API call). Cleared whenever a run resolves or the panel is removed.
let loadingTimeoutTimer: number | undefined;
// How long to wait for a result before showing the retry panel. Tab-mode
// scrapes (open destination, wait for generation, scrape) can be slow, so this
// is generous; a real result that arrives later still replaces the panel.
// (The e2e build shortens it to test a late answer.)
const LOADING_TIMEOUT_MS = Number(import.meta.env.VITE_PAGE_RUN_TIMEOUT_MS) || 180_000;

function clearLoadingTimeout(): void {
  if (loadingTimeoutTimer !== undefined) {
    window.clearTimeout(loadingTimeoutTimer);
    loadingTimeoutTimer = undefined;
  }
}

/**
 * End the in-flight run state: clear the flag + timeout. Callers that hit a
 * terminal path (result landed, error, timeout, navigation) call this so the
 * inline button can drop the "Analyzing…" cue and never sticks on it.
 */
function endRunInFlight(): void {
  runInFlight = false;
  clearLoadingTimeout();
  // The progress panel describes the run that just ended: drop it. A notice
  // (how the video was sent) stays until the summary replaces it.
  if (summaryPanelKind === "progress") removeSummaryPanel();
}

function removeSummaryPanel(): void {
  clearLoadingTimeout();
  (summaryPanel as CleanablePanel | null)?.__tldwCleanup?.();
  summaryPanel?.remove();
  summaryPanel = null;
  summaryPanelKind = null;
  summaryPanelVideoId = null;
  setWatchButtonState("idle");
}

const theme = panelTheme;


/**
 * Uniform geometry shared by every injected pill-shaped control (the inline
 * TL;DW button, the "⋯" kebab, the Auto-summarize toggle, the retry button, …).
 * A fixed height + flex centering keeps them all the SAME height regardless of
 * font-size, border, or text content; box-sizing folds any border/padding into
 * that height so bordered and borderless pills line up exactly.
 */
const PILL_HEIGHT = "30px";
const pillGeom = {
  height: PILL_HEIGHT,
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: "1",
} as const;

function ensureShimmerStyle(): void {
  if (document.getElementById("tldw-shimmer-style")) return;
  const s = document.createElement("style");
  s.id = "tldw-shimmer-style";
  // tldw-pulse (the progress step) stays readable at its faintest; neither
  // animates for people who ask for reduced motion.
  s.textContent =
    "@keyframes tldw-shimmer{0%,100%{opacity:0.35}50%{opacity:0.75}}" +
    "@keyframes tldw-pulse{0%,100%{opacity:0.7}50%{opacity:1}}" +
    "@media (prefers-reduced-motion: reduce){#tldw-watch-btn,[data-tldw-step]{animation:none!important}}";
  document.head.appendChild(s);
}

function panelHost(): Element | null {
  return (
    document.querySelector("#below") ??
    document.querySelector("ytd-watch-metadata") ??
    document.querySelector("#secondary-inner") ??
    document.querySelector("#secondary")
  );
}

// --- inline "TL;DW" button in YouTube's subscribe row -------------------------

// The persistent inline button mounted right of Subscribe (next to vidIQ). It's
// the manual entry point for a summary on a cold video, and a live status cue
// ("Analyzing…") while any run is in flight. Kept alive across YouTube's
// owner-row re-renders by the onNavigate poll; suppressed for non-summarizable
// live streams via watchButtonAllowed.
const WATCH_BTN_ID = "tldw-watch-btn";
let watchButton: HTMLButtonElement | null = null;
let watchButtonAllowed = true;

/** YouTube's owner/subscribe row — mirrors the selectors getChannelInfo() uses. */
function ownerRow(): Element | null {
  return (
    document.querySelector("ytd-watch-metadata #owner") ??
    document.querySelector("#owner") ??
    document.querySelector("ytd-video-owner-renderer")?.parentElement ??
    null
  );
}

/** Reflect the current run state on the inline button (no-op if it isn't mounted). */
function setWatchButtonState(state: "idle" | "analyzing" | "ready"): void {
  const btn = watchButton;
  if (!btn) return;
  if (state === "analyzing") {
    btn.textContent = "Analyzing…";
    btn.style.opacity = "0.75";
    btn.style.cursor = "default";
    btn.style.animation = "tldw-shimmer 1.4s infinite";
    btn.title = "Summarizing this video…";
  } else {
    btn.textContent = "TL;DW";
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
    btn.style.animation = "";
    btn.title = state === "ready"
      ? "Summary ready — click to jump to it"
      : "Summarize this video with TL;DW";
  }
}

function removeWatchButton(): void {
  document.getElementById(WATCH_BTN_ID)?.remove();
  watchButton = null;
}

/** Mount (idempotently) the inline TL;DW button in the subscribe row. */
function ensureWatchButton(): void {
  // Watch pages only, and only when allowed (not a non-summarizable live stream).
  if (!currentVideoId() || !watchButtonAllowed) { removeWatchButton(); return; }

  // Fast path for the 500ms onNavigate poll: if our button is still attached,
  // there's nothing to do — skip the getElementById + owner-row queries. Only
  // when YouTube has detached it (re-rendered the owner row) do we fall through
  // and re-find or re-mount.
  if (watchButton?.isConnected) return;

  const existing = document.getElementById(WATCH_BTN_ID) as HTMLButtonElement | null;
  if (existing) { watchButton = existing; return; }

  const row = ownerRow();
  if (!row) return; // owner row not rendered yet — the 500ms poll retries.

  ensureShimmerStyle();
  const btn = document.createElement("button");
  btn.id = WATCH_BTN_ID;
  Object.assign(btn.style, {
    fontSize: "14px", fontWeight: "700", letterSpacing: "0.02em",
    padding: "0 16px", borderRadius: "999px", marginLeft: "8px",
    background: "#1a73e8", color: "#fff", border: "none",
    cursor: "pointer", whiteSpace: "nowrap", flexShrink: "0",
    ...pillGeom,
    // Override the shared PILL_HEIGHT (30px) AFTER spreading pillGeom: this
    // inline button gets its own taller height so it aligns with YouTube's
    // ~36px Subscribe pill, without resizing every other injected pill.
    height: "36px",
  });
  btn.addEventListener("mouseenter", () => { if (btn.style.cursor === "pointer") btn.style.background = "#1557b0"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "#1a73e8"; });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!extensionContextAlive()) { tearDownOrphanedScript(); return; }
    // Catch up with an in-page navigation TL;DW hasn't handled yet (the URL
    // changes before YouTube's events and the poll), so the press is for the
    // video in the URL and the previous video's panel is gone first.
    onNavigate();
    // This video's panel already up (cached / summary): jump to it, don't re-run.
    const existing = currentVideoPanel();
    if (existing && summaryPanelKind !== "notice") {
      existing.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Already analyzing (loading lives in the button now): a second click must
    // not kick a duplicate run.
    if (runInFlight) return;
    // Flip the button to "Analyzing…" synchronously so a double-click before the
    // async run registers can't launch two runs. maybeStartDirectApiRun re-affirms
    // this when it actually starts the call (and resets it on a cold/cached exit).
    runInFlight = true;
    setWatchButtonState("analyzing");
    // forceRun serves cache first, then runs even on a non-auto channel.
    void maybeStartDirectApiRun({ forceRun: true });
  });

  // Sit right of the Subscribe button (so we land next to vidIQ's button too).
  const subscribe = row.querySelector("#subscribe-button, ytd-subscribe-button-renderer");
  if (subscribe?.parentElement) subscribe.parentElement.insertBefore(btn, subscribe.nextSibling);
  else row.appendChild(btn);

  watchButton = btn;
  // A mid-analysis re-render must keep the cue, so sync state on (re)mount.
  // Derive from runInFlight / summaryPanelKind — NOT from `summaryPanel != null`,
  // since an error panel ("idle") is a panel too and must not read as "ready".
  setWatchButtonState(
    runInFlight ? "analyzing" : summaryPanelKind === "summary" ? "ready" : "idle",
  );
}

// --- panel chrome: header, ⋯ menu, SponsorBlock line -------------------------

const LOGO_URL = () => chrome.runtime.getURL("icons/tl-dw-32.png");

/** How the run went, as the header's subtitle says it: "Your Gemini key" or "Gemini tab (no key)". */
function modeLabel(via: "api" | "tab" | undefined): string {
  const usesKey = via ? via === "api" : currentDirectApiEnabled;
  return usesKey ? "Your Gemini key" : "Gemini tab (no key)";
}

/** Profiles, read fresh for the Style menu and the subtitle. */
let knownProfiles: Pick<PromptProfile, "id" | "name">[] = [];
function refreshProfiles(): void {
  void chrome.storage.local.get("profiles").then(
    (r) => { knownProfiles = ((r["profiles"] as PromptProfile[] | undefined) ?? []).map(({ id, name }) => ({ id, name })); },
    () => {},
  );
}
refreshProfiles();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["profiles"]) refreshProfiles();
});

/** Turn the channel's auto-summarize on (after the confirmation) or off. */
function toggleAutoRun(info: ChannelInfo): void {
  if (currentAutoRunSummary) {
    currentAutoRunSummary = false;
    void writeAutoRunChannel(info, false);
    return;
  }
  // Read the mode now: the key may have been added or removed since the page loaded.
  void chrome.storage.local.get("settings").then(
    (r) => usesOwnKey(r["settings"] as Record<string, unknown> | undefined),
    () => currentDirectApiEnabled,
  ).then((usesKey) => {
    showAutoRunConfirmOverlay(info, usesKey, () => {
      currentAutoRunSummary = true;
      void writeAutoRunChannel(info, true);
    }, () => {});
  });
}

/** The "⋯" menu's entries for a summary of `vid` made with profile `profileId`. */
function summaryMenu(tldw: TldwSummary, vid: string | null): MenuEntry[] {
  const entries: MenuEntry[] = [
    {
      kind: "item", label: "Regenerate", icon: "regenerate",
      title: "Ask Gemini again with the same style, instead of using the saved summary",
      onClick: () => void rerun(vid, { profileId: tldw.profileId, bypassCache: true }),
    },
    {
      kind: "item", label: "Copy as text", icon: "copy",
      onClick: () => void navigator.clipboard.writeText(summaryText(tldw)).catch(() => {}),
    },
    {
      kind: "item", label: "Open in Gemini", icon: "external",
      title: "Open this video's summary request in a Gemini tab",
      onClick: () => void chrome.runtime.sendMessage({ type: "OPEN_OR_FOCUS_DESTINATION", videoId: vid ?? undefined, profileId: tldw.profileId }),
    },
  ];
  if (knownProfiles.length > 1) {
    entries.push({ kind: "separator" }, { kind: "heading", label: "Style" });
    for (const p of knownProfiles) {
      entries.push({
        kind: "radio", label: p.name, checked: p.id === tldw.profileId,
        onClick: () => { if (p.id !== tldw.profileId) void rerun(vid, { profileId: p.id }); },
      });
    }
  }
  entries.push({ kind: "separator" });
  const info = currentChannelInfo;
  if (info) {
    entries.push({
      kind: "item", label: `Auto-summarize ${info.name}`, icon: "auto",
      detail: currentAutoRunSummary ? "On" : "Off",
      onClick: () => toggleAutoRun(info),
    });
  }
  entries.push({
    kind: "item", label: "Settings", icon: "settings",
    onClick: () => void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "settings" }),
  });
  return entries;
}

/** The summary as plain text, for "Copy as text". */
function summaryText(tldw: TldwSummary): string {
  const lines = [plainMarkdown(tldw.summary), ""];
  for (const [i, item] of (tldw.items ?? []).entries()) {
    const lead = tldw.layout === "tutorial" ? `${i + 1}.` : "-";
    const time = item.time !== undefined ? `${formatClock(item.time)} ` : "";
    const term = item.term ? `${plainMarkdown(item.term)}: ` : "";
    const tag = item.tag ? ` (${plainMarkdown(item.tag)})` : "";
    lines.push(`${lead} ${time}${term}${plainMarkdown(item.text)}${tag}`);
  }
  if (!tldw.items?.length && tldw.details) lines.push(plainMarkdown(tldw.details));
  for (const q of tldw.questions ?? []) lines.push(`Q: ${plainMarkdown(q.question)}`, `A: ${plainMarkdown(q.answer)}`);
  if (tldw.note) lines.push("", plainMarkdown(tldw.note));
  const vid = currentVideoId();
  if (vid) lines.push("", `https://www.youtube.com/watch?v=${vid}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sponsorApi(): SponsorWindowApi | null {
  return (window as unknown as { __tldwSponsor?: SponsorWindowApi }).__tldwSponsor ?? null;
}

/**
 * A quiet line at the foot of the panel when SponsorBlock auto-skip is on:
 * each sponsor segment as start–end times you can jump to. The Undo for an
 * auto-skip lives in the notice sponsorblock.ts shows over the player.
 */
function sponsorLine(t: PanelTheme): HTMLElement | null {
  const api = sponsorApi();
  const segs = api?.getSegments() ?? [];
  if (!api || segs.length === 0) return null;
  const line = document.createElement("div");
  line.dataset.tldwSponsor = "1";
  Object.assign(line.style, {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginTop: "6px",
    font: "400 12px/1.5 Roboto, system-ui, sans-serif", color: t.sub,
  });
  line.append(icon("skip", 14), "SponsorBlock skips");
  const stamp = (seconds: number, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = formatClock(seconds);
    b.setAttribute("aria-label", `Jump to ${formatClock(seconds)}`);
    Object.assign(b.style, {
      background: "transparent", border: "none", padding: "0", cursor: "pointer",
      color: t.link, font: "500 12px/1.5 Roboto, system-ui, sans-serif", fontVariantNumeric: "tabular-nums", outline: "none",
    });
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    focusRing(b, t);
    return b;
  };
  for (const seg of segs) {
    const group = document.createElement("span");
    Object.assign(group.style, { display: "inline-flex", alignItems: "center", gap: "2px", whiteSpace: "nowrap" });
    group.append(stamp(seg.start, () => api.jumpTo(seg.index, "start")), "–", stamp(seg.end, () => api.jumpTo(seg.index, "end")));
    line.append(group);
  }
  return line;
}

/** Re-draw the SponsorBlock line in the live panel on any change. */
function refreshSponsorPanel(): void {
  const panel = summaryPanel;
  if (!panel) return;
  panel.querySelector("[data-tldw-sponsor]")?.remove();
  const line = sponsorLine(panelTheme());
  if (line) panel.append(line);
}

// sponsorblock.ts fires this whenever segments are fetched, skipped, or undone.
window.addEventListener("tldw-sponsor-update", refreshSponsorPanel);

/** A new, empty TL;DW panel box with its header. */
function newPanel(t: PanelTheme, subtitle: string | undefined, menu?: HTMLElement): HTMLElement {
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "TL;DW summary");
  Object.assign(panel.style, panelBoxStyle(t));
  panel.append(panelHeader(t, { logoUrl: LOGO_URL(), subtitle, menu, onClose: removeSummaryPanel }));
  return panel;
}

/**
 * Enter the in-flight ("Analyzing…") state. There's no skeleton panel anymore —
 * the inline TL;DW button is the sole loading indicator (it renders "Analyzing…"
 * + the tldw-shimmer animation via setWatchButtonState). We still arm a generous
 * timeout so a run that never returns (e.g. a tab-mode scrape that produced no
 * parseable answer) surfaces a retry panel instead of spinning the button
 * forever — gated on `runInFlight`, not a panel kind.
 */
function startRunInFlight(): void {
  ensureShimmerStyle();
  // Any stale panel (e.g. a prior error panel) shouldn't sit under the button
  // while a fresh run is analyzing; the real summary will re-inject on SET_SUMMARY.
  removeSummaryPanel();
  runInFlight = true;
  timedOutVideoId = null;
  // Make sure the button is mounted before flagging it: setWatchButtonState is a
  // no-op when the button isn't in the DOM yet (the owner row can render late on
  // a cold page load), which would leave an auto/cold run with no on-page cue.
  // If the row still isn't ready, the 500ms onNavigate poll re-mounts and the
  // remount derives "analyzing" from runInFlight.
  ensureWatchButton();
  setWatchButtonState("analyzing");
  // Say what is happening; the worker's SET_RUN_PROGRESS messages update it.
  showProgress("Reading the transcript…");
  log("run in flight (inline button shows Analyzing…)");
  armLoadingTimeout();
}

/**
 * Don't let a run spin forever: after a grace period with no progress, show a
 * retry panel, but only if THIS run is still the active one (same video,
 * still in flight). Each progress step re-arms it.
 */
function armLoadingTimeout(): void {
  clearLoadingTimeout();
  const loadingVid = currentVideoId();
  loadingTimeoutTimer = window.setTimeout(() => {
    if (runInFlight && currentVideoId() === loadingVid) {
      endRunInFlight();
      timedOutVideoId = loadingVid;
      showSummaryErrorPanel();
    }
  }, LOADING_TIMEOUT_MS);
}

type ErrorPanelOptions = {
  noTranscript?: boolean;
  /** The error category, which picks the panel's main action. */
  category?: string;
};

type PanelAction = { label: string; icon?: string; title?: string; primary?: boolean; onClick: () => void };

/** Start a page run that sends this video another way (a Gemini tab, or the API). */
function sendInstead(ask: { source: "page" | "page-tab" }): void {
  const vid = currentVideoId();
  if (!vid) return;
  startRunInFlight();
  void chrome.runtime.sendMessage({ type: "ASK", ...ask }).then(
    (reply: unknown) => handleAskReply(vid, reply),
    () => { /* best effort */ },
  );
}

const openKeySetup = () => void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "directapi" });

/** The buttons an error panel offers, most useful first. */
function errorPanelActions(opts: ErrorPanelOptions): PanelAction[] {
  const retry: PanelAction = {
    label: "Try again", icon: "regenerate",
    onClick: () => { if (currentSummarizeAction) void currentSummarizeAction(); },
  };
  if (opts.category === "gemini-signin") {
    // No transcript, signed out of Gemini (item 6): sign in there, then retry.
    return [
      {
        label: "Sign in to Gemini", icon: "signin", primary: true,
        title: "Open gemini.google.com to sign in, then come back and try again",
        onClick: () => { window.open("https://gemini.google.com/", "_blank", "noopener"); },
      },
      retry,
    ];
  }
  const geminiTab: PanelAction = {
    label: "Use the Gemini tab instead", icon: "tab",
    title: "Ask Gemini in a background tab; TL;DW shows its answer here",
    onClick: () => sendInstead({ source: "page-tab" }),
  };
  if (opts.category === "unauthorized") {
    return [{ label: "Replace your key", icon: "key", primary: true, onClick: openKeySetup }, retry];
  }
  if (opts.category === "quota_limited") return [geminiTab, retry];
  if (opts.category === "model_unavailable") {
    return [{ label: "Choose another model", icon: "settings", primary: true, onClick: openKeySetup }, retry];
  }
  if (opts.noTranscript) return [];
  return [{ ...retry, primary: true }];
}

/**
 * Shown when a run fails or needs the user: the reason, and the actions that
 * fix it (sign in to Gemini, replace the key, use the Gemini tab, retry).
 */
function showSummaryErrorPanel(reason?: string, actionUrl?: string, opts: ErrorPanelOptions = {}): void {
  const host = panelHost();
  if (!host) return;
  removeSummaryPanel();

  const t = panelTheme();
  const panel = newPanel(t, undefined);
  panel.setAttribute("role", "status");

  const msg = document.createElement("p");
  msg.dataset.tldwMessage = "1";
  // A specific reason from the worker (an API error, no transcript, sign-in);
  // without one, the run timed out.
  msg.textContent = reason && (opts.noTranscript || opts.category === "gemini-signin")
    ? reason
    : reason
    ? `Couldn't get the summary: ${reason}`
    : "Couldn't get the summary back in time. Without a key, the Gemini tab may still be working: check it, then try again.";
  Object.assign(msg.style, { margin: "6px 0 0", font: "400 14px/1.5 Roboto, system-ui, sans-serif", color: t.text });
  panel.append(msg);

  const actions = errorPanelActions(opts);
  if (actions.length || actionUrl) {
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginTop: "12px" });
    for (const a of actions) row.append(pillButton(t, a.label, { icon: a.icon, primary: a.primary, title: a.title, onClick: a.onClick }));
    if (actionUrl) {
      const link = document.createElement("a");
      link.href = actionUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open Google AI Studio";
      Object.assign(link.style, { display: "inline-flex", alignItems: "center", gap: "4px", color: t.link, font: "500 13px/1.4 Roboto, system-ui, sans-serif" });
      link.append(icon("external", 14));
      row.append(link);
    }
    panel.append(row);
  }
  mountPanel(host, panel);
  summaryPanelKind = "idle";
  fitPanelToViewport();
  log("summary error panel shown:", reason ?? "loading timed out");
  refreshSponsorPanel();
}

/**
 * Keep the panel inside the window. In a narrow window YouTube's own column
 * runs a few pixels past both edges (at 420px it spans -3px to 423px), and a
 * panel filling it would be clipped; inset it by what sticks out.
 */
function fitPanelToViewport(): void {
  const panel = summaryPanel;
  if (!panel?.isConnected) return;
  panel.style.marginLeft = "";
  panel.style.marginRight = "";
  const rect = panel.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  if (rect.left < 0) panel.style.marginLeft = `${Math.ceil(-rect.left) + 4}px`;
  if (rect.right > viewport) panel.style.marginRight = `${Math.ceil(rect.right - viewport) + 4}px`;
}

let fitFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(fitPanelToViewport);
});

/** The box every TL;DW panel shares. */
function panelBoxStyle(t: PanelTheme): Partial<CSSStyleDeclaration> {
  return {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 12px 12px 16px", marginTop: "12px", marginBottom: "16px",
    font: "400 14px/1.4 Roboto, system-ui, sans-serif", color: t.text,
    boxSizing: "border-box", maxWidth: "100%", overflowWrap: "anywhere",
  };
}

/**
 * While a run is in flight: what TL;DW is doing right now ("Reading the
 * transcript…", "Asking Gemini…") and, when there is one, a notice about how
 * the video is being sent. Without a run in flight (a send from the popup or
 * the shortcut), only a notice is shown, in a panel the user can close.
 */
function showProgress(step: string | undefined, notice?: string): void {
  const host = panelHost();
  if (!host) return;
  const kind = runInFlight ? "progress" : "notice";
  if (!runInFlight && !notice) return;
  const t = panelTheme();
  let panel = currentVideoPanel();
  if (!panel || (summaryPanelKind !== "progress" && summaryPanelKind !== "notice")) {
    removeSummaryPanel();
    panel = newPanel(t, modeLabel(undefined));
    const stepEl = document.createElement("div");
    stepEl.dataset.tldwStep = "1";
    stepEl.setAttribute("role", "status");
    stepEl.setAttribute("aria-live", "polite");
    Object.assign(stepEl.style, { margin: "6px 0 0", font: "400 14px/1.5 Roboto, system-ui, sans-serif", color: t.sub, animation: "tldw-pulse 1.6s ease-in-out infinite" });
    const noticeEl = document.createElement("div");
    noticeEl.dataset.tldwNotice = "1";
    Object.assign(noticeEl.style, { marginTop: "6px", font: "400 13px/1.5 Roboto, system-ui, sans-serif", color: t.text });
    panel.append(stepEl, noticeEl);
    mountPanel(host, panel);
    fitPanelToViewport();
    if (runInFlight) setWatchButtonState("analyzing");
  }
  summaryPanelKind = kind;
  // A long transcript's parts can take a while: each step re-arms the timeout.
  if (runInFlight && step) armLoadingTimeout();
  const stepEl = panel.querySelector<HTMLElement>("[data-tldw-step]");
  if (stepEl) {
    stepEl.textContent = kind === "progress" ? step ?? "" : "";
    stepEl.style.display = kind === "progress" && step ? "" : "none";
  }
  const noticeEl = panel.querySelector<HTMLElement>("[data-tldw-notice]");
  if (noticeEl && notice !== undefined) noticeEl.textContent = notice;
  if (noticeEl) noticeEl.style.display = noticeEl.textContent ? "" : "none";
  refreshSponsorPanel();
}

/**
 * Summarize this video again: Regenerate (the same style, skipping the saved
 * summary) or another style from the menu (which may be saved already).
 */
async function rerun(vid: string | null, opts: { profileId?: string; bypassCache?: boolean }): Promise<void> {
  if (!vid || vid !== currentVideoId()) return;
  // Allow this deliberate re-run to send even after an automatic one this visit.
  if (autoAskedVid === vid) autoAskedVid = null;
  removeSummaryPanel();
  await maybeStartDirectApiRun({ forceRun: true, bypassCache: opts.bypassCache, profileId: opts.profileId });
}

/** Seek the video to `seconds` and bring the player into view. */
function seekTo(seconds: number): void {
  const video = currentVideoId()
    ? document.querySelector<HTMLVideoElement>("video.html5-main-video, #movie_player video")
    : null;
  if (!video) return;
  video.currentTime = seconds;
  void video.play().catch(() => {});
  document.getElementById("movie_player")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** Where the summary came from, in a few quiet words, and the icon that goes with it. */
function sourceParts(tldw: TldwSummary): { parts: string[]; icon: string } {
  const cached = tldw.sourceKind === "cache";
  const parts: string[] = [];
  let iconName = "transcript";
  if (tldw.basis === "video") {
    iconName = "video";
    parts.push(tldw.via === "api" ? "Watched by Gemini (no transcript), so no times are shown" : "From the video's link (no transcript), so no times are shown");
  } else if (tldw.basis === "excerpt") {
    parts.push("From the start and end of the transcript (very long video)");
  } else if (tldw.basis === "public") {
    iconName = "video";
    parts.push("From public info about the video (no transcript)");
  } else if (tldw.basis === "transcript") {
    parts.push(tldw.timed ? "From the transcript · times checked against the captions" : "From the transcript");
  } else if (tldw.label) {
    // A summary saved before 1.4 kept its own label.
    parts.push(tldw.label);
  }
  if (tldw.via === "api" && tldw.model) parts.push(geminiModelLabel(tldw.model));
  if (cached) {
    parts.push("saved earlier");
    iconName = parts.length === 1 ? "saved" : iconName;
  }
  return { parts, icon: iconName };
}

function buildSummaryPanel(tldw: TldwSummary, vid: string | null): HTMLElement {
  const t = panelTheme();
  // Teardown fns (the menu's document listeners) run from removeSummaryPanel
  // via __tldwCleanup, so a panel rebuild never leaks listeners.
  const cleanups: Array<() => void> = [];
  const profileName = tldw.profileName ?? knownProfiles.find((p) => p.id === tldw.profileId)?.name;
  const subtitle = [profileName, modeLabel(tldw.via)].filter(Boolean).join(" · ");
  const menu = overflowMenu(t, () => summaryMenu(tldw, vid), cleanups);
  const panel = newPanel(t, subtitle, menu);
  panel.dataset.tldwLayout = tldw.layout ?? "legacy";
  panel.append(summaryBody(t, tldw, seekTo));
  if (tldw.fallbackNote) {
    const n = document.createElement("p");
    n.dataset.tldwFallback = "1";
    n.setAttribute("role", "note");
    n.textContent = tldw.fallbackNote;
    Object.assign(n.style, { margin: "10px 0 0", font: "400 12px/1.5 Roboto, system-ui, sans-serif", color: t.sub });
    panel.append(n);
  }
  const { parts, icon: iconName } = sourceParts(tldw);
  if (parts.length) panel.append(sourceLine(t, parts, iconName));
  (panel as CleanablePanel).__tldwCleanup = () => { for (const fn of cleanups) fn(); };
  return panel;
}

function showSummaryPanel(tldw: TldwSummary, videoId?: string | null): void {
  const host = panelHost();
  if (!host) return;
  const vid = videoId ?? currentVideoId();
  // Never put a summary on another video's page.
  if (!vid || vid !== currentVideoId()) return;
  removeSummaryPanel();
  // A result landed — the run is no longer in flight (clears the timeout and
  // the button's "Analyzing…" cue, which setWatchButtonState("ready") replaces).
  endRunInFlight();
  const panel = buildSummaryPanel(tldw, vid);
  mountPanel(host, panel);
  summaryPanelKind = "summary";
  fitPanelToViewport();
  setWatchButtonState("ready");
  log("summary panel injected");
  refreshSponsorPanel();
}

type ClosableOverlay = HTMLElement & { __tldwClose?: (confirmed: boolean) => void };

/** Close an open auto-run confirmation (as a cancel), listeners included. */
function closeAutoRunOverlay(): void {
  const open = document.getElementById("tldw-autorun-overlay") as ClosableOverlay | null;
  if (open?.__tldwClose) open.__tldwClose(false);
  else open?.remove();
}

/** Confirmation overlay shown before enabling auto-run for a channel. */
function showAutoRunConfirmOverlay(
  info: ChannelInfo,
  usesKey: boolean,
  onConfirm: () => void,
  onCancel: () => void,
): void {
  closeAutoRunOverlay();
  const t = theme();

  const overlay = document.createElement("div");
  overlay.id = "tldw-autorun-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0",
    background: "rgba(0,0,0,0.55)",
    zIndex: "2147483647",
    display: "flex", alignItems: "center", justifyContent: "center",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    background: t.bg, borderRadius: "16px",
    padding: "28px 32px", maxWidth: "440px", width: "90%",
    boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
    display: "flex", flexDirection: "column", gap: "16px",
  });

  const hd = document.createElement("div");
  Object.assign(hd.style, { display: "flex", alignItems: "center", gap: "12px" });
  const hdIcon = document.createElement("img");
  hdIcon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(hdIcon.style, { width: "48px", height: "48px", borderRadius: "8px", flexShrink: "0" });
  const hdTitle = document.createElement("span");
  hdTitle.textContent = "Enable auto-run?";
  Object.assign(hdTitle.style, { fontWeight: "700", fontSize: "18px", color: t.text });
  hd.append(hdIcon, hdTitle);

  const body = document.createElement("div");
  Object.assign(body.style, { display: "flex", alignItems: "flex-start", gap: "10px" });

  if (info.avatarUrl) {
    const avImg = document.createElement("img");
    avImg.src = info.avatarUrl;
    Object.assign(avImg.style, { width: "40px", height: "40px", borderRadius: "50%", flexShrink: "0", marginTop: "2px" });
    body.append(avImg);
  }

  const textBlock = document.createElement("div");
  Object.assign(textBlock.style, { fontSize: "13px", color: t.sub, lineHeight: "1.65" });

  const nameLine = document.createElement("div");
  Object.assign(nameLine.style, { marginBottom: "8px" });
  const chNameEl = document.createElement("strong");
  chNameEl.textContent = info.name;
  Object.assign(chNameEl.style, { fontSize: "15px", color: t.text });
  nameLine.append(
    chNameEl,
    document.createTextNode(": every new video from this channel will automatically get an AI summary."),
  );

  const { note, action } = autoRunNote(usesKey);
  const apiNote = document.createElement("div");
  Object.assign(apiNote.style, { marginBottom: "8px" });
  apiNote.textContent = note;

  const usageBtn = document.createElement("button");
  usageBtn.textContent = action.label;
  Object.assign(usageBtn.style, {
    background: "transparent", border: "none", padding: "0",
    color: "#1a73e8", cursor: "pointer", fontSize: "13px",
    textDecoration: "underline", textUnderlineOffset: "2px",
  });
  usageBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (action.target === "key-setup") void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "directapi" });
    else window.open("https://aistudio.google.com/apikey", "_blank");
  });

  textBlock.append(nameLine, apiNote, usageBtn);
  body.append(textBlock);

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "10px", justifyContent: "space-between" });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  Object.assign(cancelBtn.style, {
    padding: "10px 24px", borderRadius: "999px",
    border: `1px solid ${t.border}`, background: "transparent",
    color: t.text, cursor: "pointer", fontSize: "15px", fontWeight: "600",
  });
  // Every way out (Cancel, Enable, a backdrop click, Escape) goes through
  // close(), which also drops the document-level Escape listener.
  let closed = false;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
  const close = (confirmed: boolean) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (confirmed) onConfirm();
    else onCancel();
  };
  (overlay as ClosableOverlay).__tldwClose = close;
  cancelBtn.addEventListener("click", () => close(false));

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Enable auto-run";
  Object.assign(confirmBtn.style, {
    padding: "10px 24px", borderRadius: "999px",
    border: "none", background: "#1a73e8",
    color: "#fff", cursor: "pointer", fontSize: "15px", fontWeight: "600",
  });
  confirmBtn.addEventListener("click", () => close(true));

  row.append(cancelBtn, confirmBtn);
  modal.append(hd, body, row);
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}


// --- auto TL;DW ----------------------------------------------------------

// The video for which an automatic ASK has already been sent in the CURRENT
// visit. Both auto paths (channel auto-run + the autoTldwMinutes threshold) set
// it, so the two can't double-fire — but it's reset on every navigation, so a
// failed/interrupted run never permanently blocks a re-summarize on revisit.
// (A permanent per-video set did exactly that: a Direct-API failure left the
// next visit stuck on a 90s skeleton with no ASK.)
let autoAskedVid: string | null = null;

/** Send the automatic ASK at most once per visit. Returns false (no send) if an
 *  automatic ASK already went out for this video since the last navigation. */
function sendAutoAsk(vid: string): boolean {
  if (autoAskedVid === vid) return false;
  autoAskedVid = vid;
  // Show "Analyzing…" (the channel auto-run path already did), so the reply or a
  // SET_SUMMARY_ERROR can end the run on the page with its reason.
  if (!runInFlight) startRunInFlight();
  void chrome.runtime.sendMessage({ type: "ASK" }).then(
    (reply: unknown) => handleAskReply(vid, reply),
    () => { /* best effort */ },
  );
  return true;
}

/**
 * The worker's reply to an ASK. A refused or failed send ({ ok: false }: no
 * profile, a live stream, a failed API call...) ends the run right away with
 * the reason, instead of leaving the button on "Analyzing..." until the timeout.
 */
function handleAskReply(vid: string, reply: unknown): void {
  const res = reply as ({ ok?: boolean; error?: string; actionUrl?: string } & ErrorPanelOptions) | undefined;
  if (res?.ok !== false || currentVideoId() !== vid || !runInFlight) return;
  endRunInFlight();
  showSummaryErrorPanel(res.error, res.actionUrl, {
    noTranscript: res.noTranscript,
    category: res.category,
  });
}

/**
 * Direct API path: fires on navigation.
 * - Reads the channel auto-run list and cache from storage.
 * - If there's a cached result: show it immediately.
 * - If the channel is on the auto-run list: flip the inline button to
 *   "Analyzing…" and fire the Gemini API call automatically.
 * - Otherwise: show NO panel — the inline TL;DW button is the cold-video entry
 *   point; the per-channel auto-run toggle lives in the summary panel header.
 *
 * `forceRun` (F8 Regenerate) makes the non-auto branch run immediately instead of
 * landing the idle CTA, so the run decision lives here rather than being re-derived
 * by the caller from the resulting panel state.
 */
async function maybeStartDirectApiRun(
  opts: { forceRun?: boolean; bypassCache?: boolean; profileId?: string } = {},
): Promise<void> {
  const vid = currentVideoId();
  if (!vid) return;
  // Capture the nav epoch: if the user navigates away during any await below,
  // this run is stale and must not touch shared state or inject a panel.
  const myEpoch = navEpoch;
  const stale = () => navEpoch !== myEpoch || currentVideoId() !== vid;

  // In-progress live streams have no transcript to summarize — don't offer the
  // summary UI (no panel, no inline button). A finished/recorded live stream has
  // a transcript, so it's fine.
  if (unsummarizable()) {
    watchButtonAllowed = false;
    removeWatchButton();
    removeSummaryPanel();
    endRunInFlight();
    return;
  }

  // Set currentChannelInfo early so the auto-run toggle can use it even when we return early.
  currentChannelInfo = getChannelInfo();

  const r = await chrome.storage.local.get(["settings", AUTO_RUN_CHANNELS_KEY]);
  if (stale()) return;
  // The on-page widget shows whether or not Direct API is configured. With no
  // key the TL;DW button and auto-summarize run the tab-scrape flow (open the
  // destination, read its answer back, inject it here) instead of a headless
  // Gemini call — "show UI here" is decoupled from "which backend is set".
  const s = r["settings"] as Record<string, unknown> | undefined;
  currentDirectApiEnabled = usesOwnKey(s);

  // YouTube may not have rendered channel info yet at t=1s on a fresh page load; retry briefly.
  if (!currentChannelInfo) {
    for (let i = 0; i < 8; i++) {
      await sleep(250);
      if (stale()) return;
      currentChannelInfo = getChannelInfo();
      if (currentChannelInfo) break;
    }
  }

  // Make sure the inline TL;DW button is mounted (the manual entry point on a
  // cold video; a status cue during auto/cached runs). onNavigate re-allowed it
  // for this video; refreshLiveGate may have hidden it again since, so respect that.
  ensureWatchButton();

  const autoRunChannels = await readAutoRunChannels();
  if (stale()) return;
  const channelEntry = currentChannelInfo
    ? autoRunChannels.find((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)
    : undefined;

  currentAutoRunSummary = channelEntry?.autoRunSummary ?? false;

  // Serve the newest variant on passive navigation. The worker owns the read
  // and records the hit exactly when it delivers a result.
  const serveCached = (entry: CachedSummary) => {
    showSummaryPanel({
      ...entry.tldw,
      // A summary saved before 1.4 doesn't name its profile itself.
      profileId: entry.tldw.profileId ?? entry.profileId,
      profileName: entry.tldw.profileName ?? entry.profileName,
      source: cachedSourceLabel(entry.profileName),
      sourceKind: "cache",
    }, vid);
    log("served from cache");
  };

  // Helper: check cache first (re-reads storage for freshness), then fall back to API.
  // Note: invoked synchronously below for auto-run, or later from a user click
  // (inline button / retry button) — in the click case the run only exists for the
  // current video, so acting on it is correct.
  // `auto` true => automatic run (channel auto-run). It shares the per-visit
  // sendAutoAsk dedup with the length-threshold path so the two can't both fire
  // ASK for the same video; the inline button shows "Analyzing…" and the result
  // arrives via SET_SUMMARY. Manual runs (inline button / retry) pass auto=false so a
  // user click always re-sends, even after a prior failure.
  const startApiCall = async (auto = false) => {
    // The inline TL;DW button is the sole loading indicator now (no skeleton
    // panel); this arms the "Analyzing…" cue + the loading timeout.
    startRunInFlight();
    void getTranscript();
    log("summary run started");
    if (auto) {
      // Dedup-gated: if the threshold path already fired ASK this visit, the
      // result is coming — keep the loading panel, don't double-send.
      sendAutoAsk(vid);
      return;
    }
    try {
      const reply: unknown = await chrome.runtime.sendMessage({
        type: "ASK",
        source: "page",
        profileId: opts.profileId,
        bypassCache: opts.bypassCache ?? false,
      });
      handleAskReply(vid, reply);
    } catch { /* best effort */ }
  };
  // Expose for the loading-timeout retry panel.
  currentSummarizeAction = startApiCall;

  // A style picked from the menu may be saved already, but only the worker
  // knows the exact request; the newest saved summary would be another style.
  const cacheResult = opts.bypassCache || opts.profileId
    ? undefined
    : await chrome.runtime.sendMessage({ type: "CACHE_LOOKUP", videoId: vid }) as
        | { entry?: CachedSummary }
        | undefined;
  if (stale()) return;
  const cached = cacheResult?.entry;

  // If we already have a fresh cached result, show it directly — there's no
  // reason to drop the user back to the idle "Get Summary" view for a video
  // we've already summarized. Applies whether or not auto-run is enabled.
  if (cached) {
    serveCached(cached);
    return;
  }

  // Auto-run summary: fire immediately. In tab mode this auto-opens the
  // destination tab (the user opted into auto-summarize for this channel);
  // headless mode runs the Gemini call with no tab.
  if (currentAutoRunSummary) {
    await startApiCall(true);
    return;
  }

  // F8 Regenerate: re-run now even though this channel isn't auto-summarize,
  // instead of dropping the user back to the idle CTA.
  if (opts.forceRun) {
    await startApiCall(false);
    return;
  }

  // Cold video (no cache, channel not auto-summarize): show NO panel. The inline
  // TL;DW button mounted above is the entry point — clicking it re-enters here
  // via forceRun and runs the configured backend (headless Gemini or tab-scrape).
  // Clear any in-flight state (this is a terminal, non-running outcome) so the
  // button doesn't sit on "Analyzing…".
  // A press that landed while this passive check was awaiting (the click
  // handler runs onNavigate, which starts this check, then its own forced run)
  // owns the in-flight state: leave it alone.
  if (runInFlight) return;
  setWatchButtonState("idle");
}

/** How long the threshold path keeps waiting for the content video's length. */
const DURATION_WAIT_MS = 120_000;

/**
 * Threshold path: runs for videos over the configured length. The length isn't
 * known at once (and during a pre-roll ad the player reports the ad's), so it
 * re-checks every second until the content video's length is known. Sends an
 * ASK with source "auto": headless via Direct API when a key is configured,
 * otherwise it opens a destination tab.
 */
async function autoRunIfLong(): Promise<void> {
  const vid = currentVideoId();
  const myEpoch = navEpoch;
  // sendAutoAsk is the shared per-visit dedup with the channel auto-run path:
  // whichever fires first marks the video, so the two can't double-fire, but the
  // mark resets on navigation, so this threshold run isn't permanently blocked.
  if (!vid || summaryPanel || autoAskedVid === vid) return;

  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as Record<string, unknown> | undefined;
  const threshold = (s?.autoTldwMinutes as number) ?? 0;
  if (!threshold) return;

  const stale = () => navEpoch !== myEpoch || currentVideoId() !== vid || !extensionContextAlive();
  const deadline = Date.now() + DURATION_WAIT_MS;
  let durationSeconds = 0;
  for (;;) {
    if (stale()) return;
    durationSeconds = pageShowsCurrentVideo() ? contentDurationSeconds() : 0;
    if (durationSeconds || Date.now() >= deadline) break;
    await sleep(1000);
  }
  if (!durationSeconds || durationSeconds / 60 < threshold) return;

  // Re-check after the waits: a panel may have mounted, or we may have navigated.
  if (stale() || summaryPanel || autoAskedVid === vid || !watchButtonAllowed) return;
  log("auto-running TL;DW for", Math.round(durationSeconds / 60), "min video");
  sendAutoAsk(vid);
}

// yt-navigate-finish doesn't fire for all YouTube SPA navigation types.
// Three-layer strategy: immediate (page load / refresh), event-based (when
// YouTube fires its own event), and 500ms polling (everything else).
let lastHandledUrl = "";

/**
 * Whether this content script still belongs to a live extension. After the
 * extension is updated or reloaded, scripts already in open tabs are orphaned:
 * every chrome.* call throws "Extension context invalidated".
 */
function extensionContextAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

let navPollTimer: number | undefined;

/**
 * The extension was updated or reloaded under this tab: remove everything this
 * orphaned script put on the page and stop polling, so no dead button sits on
 * "Analyzing..." forever. Reloading the page loads the new version.
 */
function tearDownOrphanedScript(): void {
  if (navPollTimer !== undefined) window.clearInterval(navPollTimer);
  navPollTimer = undefined;
  window.removeEventListener("yt-navigate-finish", onNavigate);
  document.removeEventListener("tldw:location-change", onNavigate);
  window.removeEventListener("popstate", onNavigate);
  navEpoch++;
  runInFlight = false;
  clearLoadingTimeout();
  closeAutoRunOverlay();
  (summaryPanel as CleanablePanel | null)?.__tldwCleanup?.();
  summaryPanel?.remove();
  summaryPanel = null;
  summaryPanelKind = null;
  document.getElementById("tldw-summary")?.remove();
  removeWatchButton();
  console.log("[TL;DW] the extension was updated or reloaded; reload this page to use it");
}

/**
 * Re-check, on every poll tick, whether the video is a live broadcast with
 * nothing to summarize. Live state can't always be read at navigation time (a
 * pre-roll ad hides it, and the player can still hold the previous video), so
 * the first check alone isn't enough, in either direction: a later tick can
 * hide the button, and one that finds the video isn't live brings it back.
 * (watchButtonAllowed is turned off only for live streams.)
 */
function refreshLiveGate(): void {
  if (!pageShowsCurrentVideo()) return;
  if (watchButtonAllowed) {
    if (!unsummarizable()) return;
    log("live stream with no transcript, or video unavailable: hiding TL;DW");
    watchButtonAllowed = false;
    removeWatchButton();
    removeSummaryPanel();
    endRunInFlight();
    return;
  }
  if (!knownSummarizable()) return;
  log("not a live stream after all: showing TL;DW");
  watchButtonAllowed = true;
  void maybeStartDirectApiRun();
  void autoRunIfLong();
}

function onNavigate(): void {
  if (!extensionContextAlive()) {
    tearDownOrphanedScript();
    return;
  }
  // Normalize to video ID so URL decorations added by YouTube (?t=123, &pp=…)
  // don't trigger a spurious re-run that wipes the panels.
  const vid = currentVideoId();
  if (vid && lastHandledUrl === `v=${vid}`) refreshLiveGate();
  // Keep the inline button alive on EVERY tick (YouTube re-renders the owner row
  // on its own), independent of the URL-change guard below. ensureWatchButton is
  // idempotent and respects watchButtonAllowed; off a watch page, drop it.
  if (vid) ensureWatchButton();
  else removeWatchButton();
  const url = vid ? `v=${vid}` : (location.pathname + location.search);
  if (url === lastHandledUrl) return;
  lastHandledUrl = url;
  // Invalidate any in-flight run for the previous video before starting a new one.
  navEpoch++;
  // Reset the per-visit auto-ASK dedup so the new video can auto-summarize (and a
  // failed run on a previous visit doesn't block this one).
  autoAskedVid = null;
  // The "save these tags for the channel?" offer is per-video; drop it on nav.
  removeSummaryPanel();
  // A run for the previous video is no longer relevant — clear the in-flight
  // flag + timeout so the inline button doesn't carry "Analyzing…" onto the new
  // video (loading lives in the button now, not a panel).
  endRunInFlight();
  transcriptFlight.reset();
  currentChannelInfo = null;
  currentAutoRunSummary = false;
  // Re-allow the inline button for the new video; maybeStartDirectApiRun flips it
  // back off if this video turns out to be a non-summarizable live stream.
  watchButtonAllowed = true;
  // Off a watch page (Shorts, home, search...) there is nothing to start.
  if (!vid) return;
  void maybeStartDirectApiRun();
  setTimeout(() => { void autoRunIfLong(); }, 2500);
}

// On page refresh / initial load, delay 1 s so YouTube's Polymer components
// finish their initial render before we inject. Firing immediately (at
// document_idle) means YouTube's own DOM update wipes the panel out before
// the user sees it. yt-navigate-finish and the 500ms interval handle
// subsequent SPA navigations without any delay.
setTimeout(onNavigate, 1000);
window.addEventListener("yt-navigate-finish", onNavigate);
// The URL changes the moment a navigation starts; youtube-intercept.ts reports
// every history change, so the previous video's panel goes at once.
document.addEventListener("tldw:location-change", onNavigate);
window.addEventListener("popstate", onNavigate);
navPollTimer = window.setInterval(onNavigate, 500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === "GET_TRANSCRIPT") {
    log("transcript requested");
    // Name the video the transcript is for, so the worker can refuse one that
    // doesn't match the video it is summarizing.
    const videoId = currentVideoId();
    void getTranscript().then((read) => {
      const ours = currentVideoId() === videoId ? read : null;
      // A line without a readable time travels as null (JSON has no NaN).
      sendResponse({ transcript: ours?.text ?? null, segments: ours?.segments ?? [], videoId });
    });
    return true;
  }
  if (type === "PAUSE_VIDEO") {
    // Only the watch page's player; never a Short's.
    const video = currentVideoId()
      ? document.querySelector<HTMLVideoElement>("video.html5-main-video, video")
      : null;
    video?.pause();
    sendResponse({ paused: !!video });
    return false;
  }
  if (type === "GET_VIDEO_META") {
    sendResponse(getCurrentVideoMeta());
    return false;
  }
  if (type === "SET_SUMMARY") {
    const msg = message as { tldw?: SharedSummary; source?: string; sourceKind?: SummarySourceKind; videoId?: string; note?: string };
    const tldw = msg?.tldw;
    if (tldw?.summary) {
      const cur = currentVideoId();
      // A Direct-API call or tab-scrape can take many seconds; the user may have
      // navigated to a different video in this same tab meanwhile. If the
      // background told us which video this summary is FOR and it's no longer the
      // one on screen, drop it — rendering it would show the wrong summary AND
      // caching it under the current id would permanently poison that video's
      // cache. Fall back to current behavior only when no videoId was provided.
      if (!msg.videoId || msg.videoId !== cur) {
        sendResponse({ ok: true, shown: false });
        return false;
      }
      const vid = msg.videoId;
      // A page run that already gave up on this video: show the answer, but say
      // it came late so the worker doesn't cache it.
      const late = !runInFlight && !!vid && vid === timedOutVideoId;
      // The result for the on-screen video has arrived — end the in-flight state
      // here, unconditionally. showSummaryPanel's render can still bail if the
      // panel host is transiently missing (YouTube re-rendering #below), but the
      // run IS done and the summary is cached below; leaving runInFlight set would
      // strand the button on "Analyzing…" and fire a bogus 90s timeout error.
      endRunInFlight();
      showSummaryPanel({ ...tldw, source: msg.source, sourceKind: msg.sourceKind, fallbackNote: msg.note }, vid);
      sendResponse({ ok: true, shown: true, late });
      return false;
    }
    sendResponse({ ok: true, shown: false });
    return false;
  }
  if (type === "SET_RUN_PROGRESS") {
    const msg = message as { videoId?: string; step?: string; notice?: string };
    if (!msg.videoId || msg.videoId === currentVideoId()) showProgress(msg.step, msg.notice);
    sendResponse({ ok: true });
    return false;
  }
  if (type === "SET_SUMMARY_ERROR") {
    // The Direct-API call failed or returned an unparseable response. Surface an
    // accurate error + retry instead of letting the inline button spin out to the
    // 90s timeout and then show the misleading tab-flow message — but only if a
    // run is still in flight for the video the error is for. (Loading lives in the
    // button now; `runInFlight`, not a panel kind, is the gate.)
    // "No transcript" is shown for any send (popup, shortcut, menu), not only
    // for a run the page started: otherwise nothing would say why no summary came.
    // A decision the page must make (a transcript too long for the site, or
    // none) is likewise shown for any send.
    const msg = message as { videoId?: string; reason?: string; actionUrl?: string; decision?: boolean } & ErrorPanelOptions;
    if (!msg.videoId || msg.videoId === currentVideoId()) {
      if (runInFlight || msg.noTranscript || msg.decision) {
        endRunInFlight();
        showSummaryErrorPanel(msg.reason, msg.actionUrl, {
          noTranscript: msg.noTranscript,
          category: msg.category,
        });
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

export {};
