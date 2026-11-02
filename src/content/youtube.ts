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
  CHANNEL_TAGS_KEY,
  TAGS_KEY,
  VIDEO_TAGS_KEY,
} from "../lib/constants";
import {
  extractFromGetPanel,
  extractFromGetTranscript,
  extractFromTimedText,
  joinSegments,
  stripSegmentTimeLabels,
} from "../lib/youtubeTranscript";
import { createKeyedSingleFlight } from "../lib/singleFlight";
import {
  cachedSourceLabel,
  describeSummarySource,
  type SummarySourceKind,
} from "../lib/summarySource";
import type { CachedSummary, SponsorWindowApi, Tag, VideoMeta } from "../types";

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

let captured: string | null = null;
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
  let text: string | null = null;
  let videoId = typeof data.videoId === "string" && data.videoId ? data.videoId : null;
  if (data.kind === "get_panel") {
    const panel = extractFromGetPanel(data.body);
    text = panel?.text ?? null;
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
    log("intercepted transcript:", text.length, "chars", videoId === currentVideoId() ? "" : `(for ${videoId}, not this video)`);
  }
});

function cachedForCurrentVideo(): string | null {
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

function scrapeRenderedTranscript(): string | null {
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
    const segments = document.querySelectorAll(selector);
    if (segments.length === 0) continue;
    const joined = joinSegments([...segments].map(segmentText));
    if (joined) return joined;
  }
  return null;
}

// --- request handling -----------------------------------------------------

/** Either source: intercepted network data, or the rendered panel. */
function available(): string | null {
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

/** Fetch the transcript for `vid` by opening YouTube's panel, or null. */
async function fetchTranscript(vid: string): Promise<string | null> {
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
      log("transcript captured:", hit.length, "chars");
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
        log("transcript scraped from the panel:", scraped.length, "chars");
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
        log("transcript scraped from the panel:", scraped.length, "chars");
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
const transcriptFlight = createKeyedSingleFlight<string | null>();

async function getTranscript(): Promise<string | null> {
  // Watch pages only: on a Short (or any other page) there is nothing to read,
  // and we must not click anything on it.
  const vid = currentVideoId();
  if (!vid) return null;
  const immediate = available();
  if (immediate) {
    log("transcript ready:", immediate.length, "chars");
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

/** Whether it is known for sure that this video can be summarized after all. */
function knownSummarizable(): boolean {
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
  return { videoId, current: true, title, live: isUnsummarizableLive(), ...getVideoMeta() };
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


// --- tags: library + per-channel / per-video assignments (direct storage) ----
// chrome.storage has no atomic read-modify-write (LESSONS_LEARNED #13). Every tag
// write here is funnelled through serializeTagWrite, an in-realm promise chain, so
// two rapid clicks IN THIS TAB can't clobber each other's get→modify→set — the
// common case (the widget is the only writer of the assignment maps). It does NOT
// coordinate with writes from the worker/options page: content scripts run in the
// page origin, a separate lock scope from the extension realm, so navigator.locks
// wouldn't bridge them either. A concurrent edit of the SAME key from the options
// Tags section while clicking chips here can still lost-update; that's rare and
// accepted. The storage SHAPES are the Phase 0 contract Agent A reads for weaving.

type TagMap = Record<string, string[]>;

// Serialize tag writes within this tab: each runs after the previous one settles
// (resolve OR reject, so one failure doesn't wedge the queue), still returning the
// real result so callers see errors.
let tagWriteChain: Promise<unknown> = Promise.resolve();
function serializeTagWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = tagWriteChain.then(fn, fn);
  tagWriteChain = run.then(() => undefined, () => undefined);
  return run;
}

/** The key a channel's tags live under. Keyed by display NAME so it lines up
 *  with the rest of the channel model — history, lifetime stats, and the
 *  options Channels list all group by name, and the Channels UI looks tags up by
 *  name. (Keying by id stranded tags: real channels have an id, so id-keyed tags
 *  never matched the name-keyed Channels view.) */
function channelTagKey(info: ChannelInfo): string {
  return info.name;
}

async function readTagLibrary(): Promise<Tag[]> {
  const r = await chrome.storage.local.get(TAGS_KEY);
  return (r[TAGS_KEY] as Tag[]) ?? [];
}

async function readChannelTagMap(): Promise<TagMap> {
  const r = await chrome.storage.local.get(CHANNEL_TAGS_KEY);
  return (r[CHANNEL_TAGS_KEY] as TagMap) ?? {};
}

async function readVideoTagMap(): Promise<TagMap> {
  const r = await chrome.storage.local.get(VIDEO_TAGS_KEY);
  return (r[VIDEO_TAGS_KEY] as TagMap) ?? {};
}

/** Append a tag id to one map entry (deduped) and persist. */
function addTagAssignment(mapKey: string, key: string, tagId: string): Promise<void> {
  return serializeTagWrite(async () => {
    const r = await chrome.storage.local.get(mapKey);
    const map = (r[mapKey] as TagMap) ?? {};
    const ids = map[key] ?? [];
    if (!ids.includes(tagId)) map[key] = [...ids, tagId];
    await chrome.storage.local.set({ [mapKey]: map });
  });
}

/** Remove a tag id from one map entry and persist (drop the entry if empty). */
function removeTagAssignment(mapKey: string, key: string, tagId: string): Promise<void> {
  return serializeTagWrite(async () => {
    const r = await chrome.storage.local.get(mapKey);
    const map = (r[mapKey] as TagMap) ?? {};
    const ids = (map[key] ?? []).filter((id) => id !== tagId);
    if (ids.length) map[key] = ids;
    else delete map[key];
    await chrome.storage.local.set({ [mapKey]: map });
  });
}

/** Create a tag in the library and return it (no assignment yet). */
function createLibraryTag(label: string, prompt: string): Promise<Tag> {
  return serializeTagWrite(async () => {
    const lib = await readTagLibrary();
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tag: Tag = { id, label, prompt };
    await chrome.storage.local.set({ [TAGS_KEY]: [...lib, tag] });
    return tag;
  });
}

/** "Apply to all future videos of this channel": move ids from VIDEO_TAGS_KEY[vid]
 *  into CHANNEL_TAGS_KEY[channelKey], deduping against what's already there. */
function promoteVideoTags(vid: string, channelKey: string, tagIds: string[]): Promise<void> {
  return serializeTagWrite(async () => {
    const [chMap, vidMap] = await Promise.all([readChannelTagMap(), readVideoTagMap()]);
    const merged = [...(chMap[channelKey] ?? [])];
    for (const id of tagIds) if (!merged.includes(id)) merged.push(id);
    chMap[channelKey] = merged;
    const remaining = (vidMap[vid] ?? []).filter((id) => !tagIds.includes(id));
    if (remaining.length) vidMap[vid] = remaining;
    else delete vidMap[vid];
    await chrome.storage.local.set({ [CHANNEL_TAGS_KEY]: chMap, [VIDEO_TAGS_KEY]: vidMap });
  });
}


// --- TL;DW summary panel -------------------------------------------------

type TldwSummary = { summary: string; details?: string; source?: string; sourceKind?: SummarySourceKind };

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
let summaryPanelKind: "summary" | "idle" | null = null;

// True while a summary run is in flight (request sent, no SET_SUMMARY /
// SET_SUMMARY_ERROR / timeout yet). The inline TL;DW button shows the
// "Analyzing…" cue; this flag — not a panel kind — gates the loading timeout and
// the SET_SUMMARY_ERROR handler so errors/timeouts still surface even though
// there's no skeleton panel. MUST be cleared on every terminal path (result,
// error, timeout, navigation) so the button never sticks on "Analyzing…".
let runInFlight = false;

// The current "run a summary" action, captured so the loading-timeout error
// panel can offer a one-click Retry. Set whenever a run flow is armed.
let currentSummarizeAction: (() => Promise<void>) | null = null;
// Fires if a run sits unfinished too long (a tab-scrape that never returned, a
// dead API call). Cleared whenever a run resolves or the panel is removed.
let loadingTimeoutTimer: number | undefined;
// How long to wait for a result before showing the retry panel. Tab-mode
// scrapes (open destination, wait for generation, scrape) can be slow, so this
// is generous; a real result that arrives later still replaces the panel.
const LOADING_TIMEOUT_MS = 90_000;

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
}

function removeSummaryPanel(): void {
  clearLoadingTimeout();
  (summaryPanel as CleanablePanel | null)?.__tldwCleanup?.();
  summaryPanel?.remove();
  summaryPanel = null;
  summaryPanelKind = null;
  setWatchButtonState("idle");
}

function theme(): { bg: string; border: string; text: string; sub: string; hover: string } {
  const dark = document.documentElement.hasAttribute("dark");
  return dark
    ? { bg: "#212121", border: "#3f3f3f", text: "#f1f1f1", sub: "#aaaaaa", hover: "#383838" }
    : { bg: "#ffffff", border: "#e5e5e5", text: "#0f0f0f", sub: "#606060", hover: "#f2f2f2" };
}

// Neutral-dark fill used for the "quiet" header actions (Open tab / Gemini
// source) on hover — readable white-on-dark in both light and dark themes.
const NEUTRAL_FILL = "#3f3f3f";

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
  s.textContent = "@keyframes tldw-shimmer{0%,100%{opacity:0.35}50%{opacity:0.75}}";
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
    // A panel already up (cached / summary): jump to it, don't re-run.
    if (summaryPanel) { summaryPanel.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
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

// --- popover menu primitive (overflow "⋯" menu + tag picker) ------------------

/**
 * Anchor a small popover to a trigger element. The panel is an absolutely
 * positioned child of a relative wrapper, so it tracks the trigger as the page
 * scrolls without any recomputation. Closes on outside-click and Esc; the
 * teardown is pushed onto `cleanups` so a panel rebuild never leaks the document
 * listeners.
 */
function buildPopoverMenu(
  trigger: HTMLElement,
  t: ReturnType<typeof theme>,
  cleanups: Array<() => void>,
  align: "left" | "right" = "right",
): { wrap: HTMLElement; panel: HTMLElement; open: () => void; close: () => void; toggle: () => void } {
  const wrap = document.createElement("span");
  Object.assign(wrap.style, { position: "relative", display: "inline-flex", flexShrink: "0" });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "absolute", top: "calc(100% + 6px)", [align]: "0",
    minWidth: "200px", maxWidth: "330px",
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.30)",
    padding: "6px", zIndex: "2147483000",
    display: "none", flexDirection: "column", gap: "2px",
    font: "13px/1.4 Roboto, system-ui, sans-serif", color: t.text, textAlign: "left",
  });
  // Keep clicks inside the popover from bubbling to the summary panel's
  // detail-toggle handler (a click on the popover's padding would otherwise
  // expand/collapse the details behind it).
  panel.addEventListener("click", (e) => e.stopPropagation());
  wrap.append(trigger, panel);

  let isOpen = false;
  let armTimer: number | undefined;
  const onDocClick = (e: MouseEvent) => { if (!wrap.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    panel.style.display = "flex";
    // Defer registering the outside-click listener so the click that OPENED the
    // popover doesn't immediately close it. Track the timer so close() can cancel
    // it — otherwise a teardown (e.g. SPA nav) between open() and the timer firing
    // would register document listeners that nothing ever removes.
    armTimer = window.setTimeout(() => {
      armTimer = undefined;
      if (!isOpen) return;
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  };
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    panel.style.display = "none";
    if (armTimer !== undefined) { clearTimeout(armTimer); armTimer = undefined; }
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
  }
  const toggle = () => (isOpen ? close() : open());

  cleanups.push(close);
  return { wrap, panel, open, close, toggle };
}

/** One clickable row inside a popover menu. Fills on hover (F4): red for a
 *  destructive action, a subtle theme highlight otherwise. */
function menuItemRow(
  t: ReturnType<typeof theme>,
  label: string,
  opts: { title?: string; danger?: boolean; onClick: () => void },
): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (opts.title) b.title = opts.title;
  Object.assign(b.style, {
    display: "block", width: "100%", textAlign: "left",
    background: "transparent", border: "none", borderRadius: "7px",
    color: t.text, cursor: "pointer", whiteSpace: "nowrap",
    font: "600 13px/1.3 Roboto, system-ui, sans-serif", padding: "9px 11px",
  });
  const hoverBg = opts.danger ? "#dc2626" : t.hover;
  const hoverColor = opts.danger ? "#fff" : t.text;
  b.addEventListener("mouseenter", () => { b.style.background = hoverBg; b.style.color = hoverColor; });
  b.addEventListener("mouseleave", () => { b.style.background = "transparent"; b.style.color = t.text; });
  b.addEventListener("click", (e) => { e.stopPropagation(); opts.onClick(); });
  return b;
}

/**
 * The right-aligned "⋯" kebab that collapses the summary panel's SECONDARY
 * actions (Open tab / Clear cache / source badge) into a popover (F1). The
 * Auto-summarize toggle stays inline.
 */
function buildOverflowMenu(
  t: ReturnType<typeof theme>,
  items: Array<{ label: string; title?: string; danger?: boolean; onClick: () => void }>,
  cleanups: Array<() => void>,
): HTMLElement {
  const kebab = document.createElement("button");
  kebab.textContent = "⋯";
  kebab.setAttribute("aria-label", "More actions");
  kebab.title = "More actions";
  Object.assign(kebab.style, {
    fontSize: "18px", fontWeight: "700", padding: "0 10px",
    borderRadius: "999px", border: "2px solid transparent",
    background: t.border, color: t.sub, cursor: "pointer", flexShrink: "0",
    transition: "background 0.15s, color 0.15s", ...pillGeom,
  });
  kebab.addEventListener("mouseenter", () => { kebab.style.background = NEUTRAL_FILL; kebab.style.color = "#fff"; });
  kebab.addEventListener("mouseleave", () => { kebab.style.background = t.border; kebab.style.color = t.sub; });

  const { wrap, panel, toggle, close } = buildPopoverMenu(kebab, t, cleanups, "right");
  for (const item of items) {
    panel.append(menuItemRow(t, item.label, {
      title: item.title, danger: item.danger,
      onClick: () => { close(); item.onClick(); },
    }));
  }
  kebab.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  return wrap;
}

// --- auto-run pill toggle (shared by all panel states) -----------------------

/**
 * A small pill button in the panel header that shows/toggles per-channel
 * auto-summarize state. ON shows a red STOP outline so the state is clear.
 */
function buildAutoToggle(
  info: ChannelInfo,
  initialOn: boolean,
  t: ReturnType<typeof theme>,
): HTMLButtonElement {
  // OFF state reads as the offer ("turn it on"); ON state reads as a clear,
  // unmistakable red STOP so it never looks like "nothing changed".
  const offLabel = "↻ Auto-summarize";
  const onLabel = "■ Stop auto-summarize";
  const enableColor = "#1a73e8"; // feature color, used as OFF-hover preview
  const STOP_COLOR = "#dc2626";

  const btn = document.createElement("button");
  Object.assign(btn.style, {
    fontSize: "13px", fontWeight: "700", letterSpacing: "0.04em",
    padding: "0 12px", borderRadius: "999px", border: "2px solid transparent",
    cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
    background: t.border,
    // Include `background` so the F4 hover fill eases like the sibling header
    // pills (Gemini / kebab), not snap instantly.
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
    ...pillGeom,
  });

  let isOn = initialOn;
  // ON is shown by a red OUTLINE on the same gray pill (not a loud solid red).
  const applyState = (on: boolean) => {
    isOn = on;
    btn.textContent = on ? onLabel : offLabel;
    btn.style.background = t.border;
    btn.style.borderColor = on ? STOP_COLOR : "transparent";
    btn.style.color = on ? STOP_COLOR : t.sub;
    btn.title = on
      ? `Auto-summarize is ON for ${info.name} — click to stop`
      : `Turn on auto-summarize for ${info.name}`;
  };

  applyState(initialOn);

  btn.addEventListener("mouseenter", () => {
    // F4 fill-on-hover: OFF → blue fill (turn it on); ON → red fill (stop).
    // White text either way; the resting ON state keeps its red outline so the
    // STOP semantics stay clear even without hover.
    btn.style.background = isOn ? STOP_COLOR : enableColor;
    btn.style.borderColor = isOn ? STOP_COLOR : enableColor;
    btn.style.color = "#fff";
  });
  btn.addEventListener("mouseleave", () => {
    applyState(isOn);
  });

  let busy = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (busy) return;
    const enabling = !currentAutoRunSummary;
    if (enabling) {
      busy = true;
      showAutoRunConfirmOverlay(info, () => {
        currentAutoRunSummary = true;
        applyState(true);
        void writeAutoRunChannel(info, true).finally(() => { busy = false; });
      }, () => { busy = false; });
      return;
    }
    busy = true;
    currentAutoRunSummary = false;
    applyState(false);
    void writeAutoRunChannel(info, false).finally(() => { busy = false; });
  });

  return btn;
}

/** Shared header row builder used by all panel states. */
function buildPanelHead(
  t: ReturnType<typeof theme>,
  controls: HTMLElement[],
  channelInfo: ChannelInfo | null,
  showAutoRunToggle = true,
  showTitle = true,
  rightControls: HTMLElement[] = [],
  endControls: HTMLElement[] = [],
): HTMLElement {
  const head = document.createElement("div");
  // flexWrap so the inline SponsorBlock widget can wrap below if the row is tight.
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" });

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(icon.style, { width: "32px", height: "32px", borderRadius: "7px", flexShrink: "0" });

  const title = document.createElement("span");
  title.textContent = "TL;DW";
  Object.assign(title.style, { fontWeight: "700", fontSize: "15px", color: t.text, flexShrink: "0" });

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  spacer.dataset.tldwSpacer = "1"; // anchor for inserting the SponsorBlock widget

  const closeBtn = document.createElement("button");
  Object.assign(closeBtn.style, {
    background: "transparent", border: "none", color: t.sub,
    cursor: "pointer", fontSize: "14px", lineHeight: "1",
    padding: "4px 6px", borderRadius: "6px", flexShrink: "0",
  });
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Hide TL;DW");
  closeBtn.addEventListener("mouseenter", () => (closeBtn.style.background = t.hover));
  closeBtn.addEventListener("mouseleave", () => (closeBtn.style.background = "transparent"));
  closeBtn.addEventListener("click", () => {
    removeSummaryPanel();
  });

  const autoToggles: HTMLElement[] = [];
  if (channelInfo && showAutoRunToggle) {
    autoToggles.push(buildAutoToggle(channelInfo, currentAutoRunSummary, t));
  }

  closeBtn.style.marginLeft = "12px";
  // Right cluster order: extra right controls · Auto-summarize ·
  // end controls (e.g. the "⋯" overflow menu) · ✕
  head.append(
    icon,
    ...(showTitle ? [title] : []),
    ...controls,
    spacer,
    ...rightControls,
    ...autoToggles,
    ...endControls,
    closeBtn,
  );
  // The SponsorBlock widget is inserted in line with the header (left of the
  // spacer) by refreshSponsorPanel, which each panel calls right after it mounts.
  return head;
}

// --- SponsorBlock widget (data + actions supplied by sponsorblock.ts via window) ---

const SPONSOR_SECTION_ID = "tldw-sponsor-widget";
// Collapsed view preference (persists across panel rebuilds within a session).
let sponsorCollapsed = false;

function sponsorApi(): SponsorWindowApi | null {
  return (window as unknown as { __tldwSponsor?: SponsorWindowApi }).__tldwSponsor ?? null;
}

/** Seconds → m:ss (or h:mm:ss for long videos). */
function secToClock(s: number): string {
  const sec = Math.max(0, Math.round(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Inline SponsorBlock widget for the panel header. Shows that auto-skip is on,
 * and for each sponsor a pair of YouTube-style clickable timestamps (start /
 * end) you can jump to. An Undo appears briefly right after an auto-skip (and
 * disappears once you've watched past the ad). Click "⏭" to collapse/expand.
 */
function buildSponsorWidget(t: ReturnType<typeof theme>): HTMLElement | null {
  const api = sponsorApi();
  const segs = api?.getSegments() ?? [];
  if (!api || segs.length === 0) return null;

  const wrap = document.createElement("span");
  wrap.id = SPONSOR_SECTION_ID;
  Object.assign(wrap.style, {
    display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "6px",
    fontSize: "12px", color: t.sub, flexShrink: "0",
  });

  const toggle = document.createElement("button");
  toggle.textContent = sponsorCollapsed
    ? `⏭ SponsorBlock (${segs.length})`
    : "⏭ SponsorBlock · auto-skip:";
  toggle.title = "SponsorBlock auto-skip is on — click to " + (sponsorCollapsed ? "expand" : "collapse");
  Object.assign(toggle.style, {
    background: "transparent", border: "none", color: t.sub,
    cursor: "pointer", fontWeight: "700", fontSize: "12px", padding: "0", flexShrink: "0",
  });
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    sponsorCollapsed = !sponsorCollapsed;
    refreshSponsorPanel();
  });
  wrap.append(toggle);
  if (sponsorCollapsed) return wrap;

  // A single YouTube-style (blue) clickable timestamp.
  const stamp = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = `Jump to ${label}`;
    Object.assign(b.style, {
      background: "transparent", border: "none", color: "#3ea6ff",
      cursor: "pointer", fontWeight: "700", fontSize: "12px", padding: "0",
    });
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  };

  for (const seg of segs) {
    const group = document.createElement("span");
    Object.assign(group.style, {
      display: "inline-flex", alignItems: "center", gap: "4px",
      background: t.border, borderRadius: "999px", padding: "2px 9px", whiteSpace: "nowrap",
    });

    const dash = document.createElement("span");
    dash.textContent = "–";
    dash.style.color = t.sub;

    group.append(
      stamp(secToClock(seg.start), () => api.jumpTo(seg.index, "start")),
      dash,
      stamp(secToClock(seg.end), () => api.jumpTo(seg.index, "end")),
    );

    // Undo shows only in the window right after an auto-skip.
    if (seg.undoable) {
      const undo = document.createElement("button");
      undo.textContent = "↩ Undo";
      Object.assign(undo.style, {
        background: "transparent", border: "none", color: "#1a73e8",
        cursor: "pointer", fontWeight: "700", fontSize: "12px", padding: "0", marginLeft: "2px",
      });
      undo.addEventListener("click", (e) => { e.stopPropagation(); api.jumpTo(seg.index, "start"); });
      group.append(undo);
    }
    wrap.append(group);
  }
  return wrap;
}

/** Re-insert the SponsorBlock widget into the live panel header on any change. */
function refreshSponsorPanel(): void {
  const head = summaryPanel?.querySelector<HTMLElement>(":scope > div");
  if (!head) return;
  head.querySelector(`#${SPONSOR_SECTION_ID}`)?.remove();
  const widget = buildSponsorWidget(theme());
  if (!widget) return;
  const spacer = head.querySelector<HTMLElement>("[data-tldw-spacer]");
  if (spacer) head.insertBefore(widget, spacer);
  else head.append(widget);
}

// sponsorblock.ts fires this whenever segments are fetched, skipped, or undone.
window.addEventListener("tldw-sponsor-update", refreshSponsorPanel);

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
  // Make sure the button is mounted before flagging it: setWatchButtonState is a
  // no-op when the button isn't in the DOM yet (the owner row can render late on
  // a cold page load), which would leave an auto/cold run with no on-page cue.
  // If the row still isn't ready, the 500ms onNavigate poll re-mounts and the
  // remount derives "analyzing" from runInFlight.
  ensureWatchButton();
  setWatchButtonState("analyzing");
  log("run in flight (inline button shows Analyzing…)");

  // Don't let the run spin forever. After a grace period, surface a retry panel —
  // but only if THIS run is still the active one (same video, still in flight).
  clearLoadingTimeout();
  const loadingVid = currentVideoId();
  loadingTimeoutTimer = window.setTimeout(() => {
    if (runInFlight && currentVideoId() === loadingVid) {
      endRunInFlight();
      showSummaryErrorPanel();
    }
  }, LOADING_TIMEOUT_MS);
}

/**
 * Shown when a loading panel times out — the API call or the tab-mode scrape
 * never returned a usable summary. Offers a one-click retry and explains the
 * tab-mode caveat so the user isn't left staring at a dead skeleton.
 */
function showSummaryErrorPanel(reason?: string, actionUrl?: string, opts: { noTranscript?: boolean } = {}): void {
  const host = panelHost();
  if (!host) return;
  removeSummaryPanel();

  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
  });

  const retryBtn = document.createElement("button");
  retryBtn.textContent = "↻ Try again";
  Object.assign(retryBtn.style, {
    fontSize: "13px", fontWeight: "700", letterSpacing: "0.03em",
    padding: "0 14px", borderRadius: "999px",
    background: "#1a73e8", color: "#fff",
    border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: "0",
    ...pillGeom,
  });
  retryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentSummarizeAction) void currentSummarizeAction();
  });

  const head = buildPanelHead(t, [], currentChannelInfo, false, true, [retryBtn]);
  Object.assign(head.style, { marginBottom: "8px" });

  const msg = document.createElement("div");
  // Prefer a specific reason from the Direct-API path (e.g. "quota exceeded",
  // "input too long"); fall back to the generic tab-flow timeout copy.
  // No transcript is not a failed request: say so plainly, with no prefix.
  msg.textContent = reason && opts.noTranscript
    ? reason
    : reason
    ? `Couldn't get the summary: ${reason}`
    : "Couldn't get the summary back in time. If you're using the tab flow (no API key), " +
      "the destination tab may still be working or may need a sign-in — check it, then retry.";
  Object.assign(msg.style, { fontSize: "13px", lineHeight: "1.5", color: t.sub });

  panel.append(head, msg);
  if (actionUrl) {
    const action = document.createElement("a");
    action.href = actionUrl;
    action.target = "_blank";
    action.rel = "noreferrer";
    action.textContent = "Open Google AI Studio ↗";
    Object.assign(action.style, {
      display: "inline-block",
      marginTop: "8px",
      color: "#1a73e8",
      fontWeight: "600",
      fontSize: "12px",
    });
    panel.append(action);
  }
  summaryPanel = panel;
  summaryPanelKind = "idle";
  host.prepend(panel);
  log("summary error panel shown:", reason ?? "loading timed out");
  refreshSponsorPanel();
}

// F8 "Regenerate" tag tie-in: when the user forces a re-run while VIDEO-ONLY tags
// are active, remember the video so the fresh summary can offer to save those
// tags for the whole channel. Cleared on navigation and once the offer is acted on.
let pendingTagPromptVid: string | null = null;

type RegenOpts = {
  /** Arm the "save these tags for the channel?" offer for the fresh summary (F8). */
  promote?: boolean;
  /** Re-run even on a non-auto channel (Regenerate), vs. just dropping back to the
   *  configured flow (Clear cache, which lands the idle CTA for manual channels). */
  forceRun?: boolean;
  /** Force a live request even if the effective prompt has an exact cache match. */
  bypassCache?: boolean;
};

/**
 * Drop this video's cache and re-run (F8 Regenerate / Clear cache). Reuses the
 * existing flow: clear cache → maybeStartDirectApiRun. For an auto-run channel
 * that fires a fresh Gemini call automatically; `forceRun` additionally kicks the
 * run for a manual channel (which would otherwise just land the idle CTA), so
 * "Regenerate" always re-summarizes. The cache-skip + autoAskedVid dedup keeps it
 * to a single ASK / single count.
 */
async function regenerateSummary(vid: string | null, opts: RegenOpts = {}): Promise<void> {
  const { promote = false, forceRun = false, bypassCache = forceRun } = opts;
  const startEpoch = navEpoch;
  // Arm (Regenerate) or clear (Clear cache) the promote offer. The rebuilt
  // summary's tags row recomputes the actual video-only set and drops the flag if
  // none remain, so we only need to flag the video here — no extra storage read.
  pendingTagPromptVid = promote && vid ? vid : null;

  // Ask the worker to drop every variant for this video. Wrap in try/catch so a storage hiccup can't
  // skip the re-run below — the old clearBtn used .finally to re-run regardless.
  try {
    if (vid) await chrome.runtime.sendMessage({ type: "CACHE_CLEAR", videoId: vid });
  } catch { /* best effort — still re-run below */ }
  // Bail if the user navigated during the awaited storage I/O — otherwise we'd
  // tear down the freshly-injected panel for the NEW video (LESSONS_LEARNED #9).
  if (navEpoch !== startEpoch) return;
  // Allow this deliberate re-run to fire a fresh ASK: on an auto-run channel the
  // per-visit dedup already marked this video, which would otherwise swallow the
  // re-run and leave the loading panel spinning. Reset to null so sendAutoAsk can
  // fire exactly once (no double-count — it re-marks the video immediately).
  if (vid && autoAskedVid === vid) autoAskedVid = null;
  removeSummaryPanel();
  // forceRun makes maybeStartDirectApiRun re-run even on a non-auto channel, so the
  // run decision lives in one place (no post-hoc panel-state inspection here).
  await maybeStartDirectApiRun({ forceRun, bypassCache });
}

// --- tags row (F6-UI) building blocks ----------------------------------------

/** A small round glyph button (× remove, ↑ promote) used inside tag chips. */
function iconBtn(glyph: string, title: string, color: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = glyph;
  b.title = title;
  Object.assign(b.style, {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "18px", height: "18px", borderRadius: "50%",
    background: "transparent", border: "none", color,
    cursor: "pointer", fontSize: "13px", lineHeight: "1", padding: "0", flexShrink: "0",
  });
  b.addEventListener("mouseenter", () => { b.style.background = "rgba(127,127,127,0.25)"; });
  b.addEventListener("mouseleave", () => { b.style.background = "transparent"; });
  return b;
}

/** Uppercase section heading inside the tag picker popover. */
function tagSectionLabel(t: ReturnType<typeof theme>, text: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em",
    textTransform: "uppercase", color: t.sub, margin: "0 0 6px",
  });
  return el;
}

/** A text input styled for the tag picker; stops clicks from toggling the panel. */
function tagInput(t: ReturnType<typeof theme>, placeholder: string): HTMLInputElement {
  const inp = document.createElement("input");
  inp.type = "text";
  inp.placeholder = placeholder;
  Object.assign(inp.style, {
    width: "100%", boxSizing: "border-box", marginBottom: "6px",
    padding: "7px 9px", borderRadius: "7px", border: `1px solid ${t.border}`,
    background: t.bg, color: t.text, fontSize: "12px",
  });
  inp.addEventListener("input", () => { inp.style.borderColor = t.border; });
  inp.addEventListener("click", (e) => e.stopPropagation());
  return inp;
}

/** One active tag chip with scope marker, optional promote (↑), and remove (×). */
function buildTagChip(
  t: ReturnType<typeof theme>,
  tag: Tag,
  origin: "channel" | "video",
  vid: string | null,
  chKey: string | null,
  rebuild: () => void,
): HTMLElement {
  const chip = document.createElement("span");
  Object.assign(chip.style, {
    display: "inline-flex", alignItems: "center", gap: "5px",
    background: t.border, color: t.text, borderRadius: "999px",
    padding: "2px 4px 2px 10px", whiteSpace: "nowrap", fontSize: "12px", fontWeight: "600",
  });

  const labelEl = document.createElement("span");
  labelEl.textContent = tag.label;
  if (tag.prompt) chip.title = tag.prompt;
  chip.append(labelEl);

  const scope = document.createElement("span");
  scope.textContent = origin === "channel" ? "· channel" : "· video";
  Object.assign(scope.style, { color: t.sub, fontSize: "10px", fontWeight: "700", letterSpacing: "0.03em" });
  chip.append(scope);

  // Promote (this-video → channel) — only meaningful for a video-only tag.
  if (origin === "video" && vid && chKey) {
    const promote = iconBtn("↑", `Apply "${tag.label}" to all future videos of this channel`, t.sub);
    promote.addEventListener("click", (e) => {
      e.stopPropagation();
      void promoteVideoTags(vid, chKey, [tag.id]).then(rebuild);
    });
    chip.append(promote);
  }

  const remove = iconBtn("×", `Remove "${tag.label}"`, t.sub);
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    const mapKey = origin === "channel" ? CHANNEL_TAGS_KEY : VIDEO_TAGS_KEY;
    const key = origin === "channel" ? chKey : vid;
    if (!key) return;
    void removeTagAssignment(mapKey, key, tag.id).then(rebuild);
  });
  chip.append(remove);

  return chip;
}

/** The "+ add" control: a popover to pick a library tag or quick-create one,
 *  scoped to this channel or this video only. */
function buildTagAddControl(
  t: ReturnType<typeof theme>,
  library: Tag[],
  vid: string,
  channelInfo: ChannelInfo,
  cleanups: Array<() => void>,
  rebuild: () => void,
): HTMLElement {
  const addBtn = document.createElement("button");
  addBtn.textContent = "+ add";
  addBtn.title = "Add a tag for this channel or just this video";
  Object.assign(addBtn.style, {
    background: "transparent", border: `1px dashed ${t.sub}`, color: t.sub,
    cursor: "pointer", fontWeight: "700", fontSize: "12px",
    borderRadius: "999px", padding: "2px 10px", flexShrink: "0",
  });
  addBtn.addEventListener("mouseenter", () => { addBtn.style.color = t.text; addBtn.style.borderColor = t.text; });
  addBtn.addEventListener("mouseleave", () => { addBtn.style.color = t.sub; addBtn.style.borderColor = t.sub; });

  const chKey = channelTagKey(channelInfo);
  const { wrap, panel, close, toggle } = buildPopoverMenu(addBtn, t, cleanups, "left");
  Object.assign(panel.style, { minWidth: "260px", gap: "0", padding: "10px" });

  let scopeSel: "channel" | "video" = "video";
  const assign = (tagId: string) => {
    const mapKey = scopeSel === "channel" ? CHANNEL_TAGS_KEY : VIDEO_TAGS_KEY;
    const key = scopeSel === "channel" ? chKey : vid;
    void addTagAssignment(mapKey, key, tagId).then(() => { close(); rebuild(); });
  };

  // Scope toggle: this video only vs the whole channel.
  const scopeWrap = document.createElement("div");
  Object.assign(scopeWrap.style, { display: "flex", gap: "6px", marginBottom: "10px" });
  const mkScope = (text: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      flex: "1", padding: "6px 8px", borderRadius: "7px", cursor: "pointer",
      border: `1px solid ${t.border}`, fontSize: "12px", fontWeight: "700",
      background: "transparent", color: t.sub,
    });
    return b;
  };
  const videoScopeBtn = mkScope("This video only");
  const channelScopeBtn = mkScope("For this channel");
  const paintScope = () => {
    const paint = (b: HTMLButtonElement, on: boolean) => {
      b.style.background = on ? "#1a73e8" : "transparent";
      b.style.color = on ? "#fff" : t.sub;
      b.style.borderColor = on ? "#1a73e8" : t.border;
    };
    paint(videoScopeBtn, scopeSel === "video");
    paint(channelScopeBtn, scopeSel === "channel");
  };
  videoScopeBtn.addEventListener("click", (e) => { e.stopPropagation(); scopeSel = "video"; paintScope(); });
  channelScopeBtn.addEventListener("click", (e) => { e.stopPropagation(); scopeSel = "channel"; paintScope(); });
  paintScope();
  scopeWrap.append(videoScopeBtn, channelScopeBtn);
  panel.append(scopeWrap);

  // Existing library tags.
  if (library.length) {
    panel.append(tagSectionLabel(t, "From your library"));
    const list = document.createElement("div");
    Object.assign(list.style, {
      display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px",
      maxHeight: "120px", overflowY: "auto",
    });
    for (const tag of library) {
      const b = document.createElement("button");
      b.textContent = tag.label;
      if (tag.prompt) b.title = tag.prompt;
      Object.assign(b.style, {
        background: t.border, color: t.text, border: "none", borderRadius: "999px",
        padding: "4px 10px", cursor: "pointer", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap",
      });
      b.addEventListener("mouseenter", () => { b.style.background = "#1a73e8"; b.style.color = "#fff"; });
      b.addEventListener("mouseleave", () => { b.style.background = t.border; b.style.color = t.text; });
      b.addEventListener("click", (e) => { e.stopPropagation(); assign(tag.id); });
      list.append(b);
    }
    panel.append(list);
  }

  // Quick-create a new tag (label + prompt) and assign it in the chosen scope.
  panel.append(tagSectionLabel(t, "Quick-create"));
  const labelInput = tagInput(t, "Label (e.g. Citations)");
  const promptInput = tagInput(t, "Prompt woven into the summary");
  panel.append(labelInput, promptInput);

  const createBtn = document.createElement("button");
  createBtn.textContent = "Create & add";
  Object.assign(createBtn.style, {
    width: "100%", marginTop: "4px", padding: "8px", borderRadius: "8px",
    background: "#1a73e8", color: "#fff", border: "none", cursor: "pointer",
    fontSize: "13px", fontWeight: "700",
  });
  let creating = false;
  const submitCreate = () => {
    if (creating) return; // guard against a double-click creating two library tags
    const label = labelInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!label) labelInput.style.borderColor = "#dc2626";
    if (!prompt) promptInput.style.borderColor = "#dc2626";
    if (!label || !prompt) return;
    creating = true;
    void createLibraryTag(label, prompt)
      .then((tag) => assign(tag.id))
      .finally(() => { creating = false; });
  };
  createBtn.addEventListener("click", (e) => { e.stopPropagation(); submitCreate(); });
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitCreate(); }
  });
  panel.append(createBtn);

  addBtn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  return wrap;
}

/** F8 tie-in banner: "Save these tags for future videos of this channel?" */
function buildPromoteAllBanner(
  t: ReturnType<typeof theme>,
  vid: string,
  chKey: string,
  tagIds: string[],
  rebuild: () => void,
): HTMLElement {
  const banner = document.createElement("span");
  Object.assign(banner.style, {
    display: "inline-flex", alignItems: "center", gap: "8px",
    background: t.hover, borderRadius: "8px", padding: "4px 6px 4px 10px",
    fontSize: "12px", color: t.text, flexShrink: "0",
  });
  const msg = document.createElement("span");
  msg.textContent = "Save these tags for future videos of this channel?";

  const save = document.createElement("button");
  save.textContent = "Save";
  Object.assign(save.style, {
    background: "#1a73e8", color: "#fff", border: "none", borderRadius: "999px",
    padding: "3px 12px", cursor: "pointer", fontWeight: "700", fontSize: "12px", flexShrink: "0",
  });
  save.addEventListener("click", (e) => {
    e.stopPropagation();
    pendingTagPromptVid = null;
    void promoteVideoTags(vid, chKey, tagIds).then(rebuild);
  });

  const dismiss = iconBtn("×", "Dismiss", t.sub);
  dismiss.addEventListener("click", (e) => {
    e.stopPropagation();
    pendingTagPromptVid = null;
    rebuild();
  });

  banner.append(msg, save, dismiss);
  return banner;
}

/**
 * F6-UI — the bottom "Tags:" row of a loaded summary. Shows the tags active for
 * this video (channel tags ∪ video tags, resolved against the library), with
 * add / remove / promote controls, a "↻ Regenerate" action, and an "Edit tags →"
 * deep link. Re-reads storage and re-renders itself after every change so it
 * always reflects what's persisted (and what Agent A weaves into the prompt).
 */
function buildTagsRow(
  t: ReturnType<typeof theme>,
  vid: string | null,
  cleanups: Array<() => void>,
): HTMLElement {
  const row = document.createElement("div");
  Object.assign(row.style, {
    borderTop: `1px solid ${t.border}`,
    marginTop: "8px", paddingTop: "7px",
    fontSize: "12px", color: t.sub,
    display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center",
  });

  const channelInfo = currentChannelInfo;
  const chKey = channelInfo ? channelTagKey(channelInfo) : null;

  // Each rebuild() recreates the "+ add" popover, so its teardown is kept in a
  // single-slot list (drained + replaced per rebuild) rather than pushed onto the
  // panel-wide `cleanups` — otherwise that array would grow one stale closure per
  // tag edit for the panel's lifetime. One panel-level cleanup closes whatever the
  // current popover is.
  const addControlCleanups: Array<() => void> = [];
  cleanups.push(() => { for (const fn of addControlCleanups.splice(0)) fn(); });

  const rebuild = async () => {
    // Guard against a late rebuild landing on a different video after navigation.
    if (vid && currentVideoId() !== vid) return;
    // Close + forget the previous rebuild's add-control popover before rebuilding.
    for (const fn of addControlCleanups.splice(0)) fn();
    const [library, chMap, vidMap] = await Promise.all([
      readTagLibrary(), readChannelTagMap(), readVideoTagMap(),
    ]);
    if (vid && currentVideoId() !== vid) return;

    const byId = new Map(library.map((tag) => [tag.id, tag]));
    const channelIds = chKey ? chMap[chKey] ?? [] : [];
    const videoIds = vid ? vidMap[vid] ?? [] : [];

    const children: HTMLElement[] = [];

    const label = document.createElement("span");
    label.textContent = "Tags:";
    Object.assign(label.style, { fontWeight: "700", flexShrink: "0" });
    children.push(label);

    const seen = new Set<string>();
    const addChip = (id: string, origin: "channel" | "video") => {
      if (seen.has(id)) return;
      const tag = byId.get(id);
      if (!tag) return; // assignment references a deleted library tag — skip it
      seen.add(id);
      children.push(buildTagChip(t, tag, origin, vid, chKey, rebuild));
    };
    for (const id of channelIds) addChip(id, "channel");
    for (const id of videoIds) if (!channelIds.includes(id)) addChip(id, "video");

    if (seen.size === 0) {
      const none = document.createElement("span");
      none.textContent = "none yet";
      none.style.opacity = "0.7";
      children.push(none);
    }

    if (vid && channelInfo) {
      children.push(buildTagAddControl(t, library, vid, channelInfo, addControlCleanups, rebuild));
    }

    // ↻ Regenerate (F8) — force a fresh run that picks up any tags just added.
    if (vid) {
      const regen = document.createElement("button");
      regen.textContent = "↻ Regenerate";
      regen.title = "Re-run the summary now (counts as a Gemini request). Uses any tags you've added.";
      Object.assign(regen.style, {
        background: "transparent", border: `1px solid ${t.border}`, color: t.sub,
        cursor: "pointer", fontWeight: "700", fontSize: "12px",
        borderRadius: "999px", padding: "2px 10px", flexShrink: "0",
      });
      regen.addEventListener("mouseenter", () => { regen.style.background = "#1a73e8"; regen.style.color = "#fff"; regen.style.borderColor = "#1a73e8"; });
      regen.addEventListener("mouseleave", () => { regen.style.background = "transparent"; regen.style.color = t.sub; regen.style.borderColor = t.border; });
      regen.addEventListener("click", (e) => { e.stopPropagation(); void regenerateSummary(vid, { promote: true, forceRun: true }); });
      children.push(regen);
    }

    const edit = document.createElement("button");
    edit.textContent = "Edit tags →";
    edit.title = "Open the Tags section in TL;DW options";
    Object.assign(edit.style, {
      background: "transparent", border: "none", color: "#3ea6ff",
      cursor: "pointer", fontWeight: "700", fontSize: "12px", padding: "0",
      marginLeft: "2px", flexShrink: "0",
    });
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "tags" });
    });
    children.push(edit);

    // F8: after a regen with video-only tags active, offer to save them channel-wide.
    if (pendingTagPromptVid && pendingTagPromptVid === vid && chKey) {
      const videoOnly = videoIds.filter((id) => !channelIds.includes(id) && byId.has(id));
      if (videoOnly.length) children.push(buildPromoteAllBanner(t, vid, chKey, videoOnly, rebuild));
      else pendingTagPromptVid = null;
    }

    row.replaceChildren(...children);
  };

  void rebuild();
  return row;
}

function buildSummaryPanel(
  tldw: TldwSummary,
  videoId?: string | null,
): HTMLElement {
  const t = theme();
  const vid = videoId ?? currentVideoId();
  // Teardown fns (popover document listeners) run from removeSummaryPanel via
  // __tldwCleanup, so a panel rebuild never leaks listeners.
  const cleanups: Array<() => void> = [];

  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif", color: t.text,
  });

  // --- header: "⋯" overflow menu (F1) ---
  // The panel is summary-only: no AI verdict pill and no engagement/rating cue.
  const headerControls: HTMLElement[] = [];

  // F1: collapse the secondary actions (Open tab / Clear cache / source badge)
  // into a right-aligned "⋯" popover. The Auto-summarize toggle (added by
  // buildPanelHead) stays inline; the Tags row lives at the bottom of the panel.
  const menuItems: Array<{ label: string; title?: string; danger?: boolean; onClick: () => void }> = [];

  // ↗ Open tab — jump to the AI destination tab (reuses the scraped one if open).
  menuItems.push({
    label: "↗ Open tab",
    title: "Go to the AI destination tab (reuses the one we scraped if it's still open)",
    onClick: () => void chrome.runtime.sendMessage({
      type: "OPEN_OR_FOCUS_DESTINATION",
      videoId: vid ?? undefined,
    }),
  });

  // 🧹 Clear cache — drop THIS video's cached summary and start fresh.
  menuItems.push({
    label: "🧹 Clear cache",
    title: "Remove this video's cached summary and start fresh",
    danger: true,
    onClick: () => { void regenerateSummary(vid, {}); },
  });

  // Source / Cached badge as a menu row, honest about origin and pointing where
  // it makes sense. When Direct API isn't set up and there's no origin to show,
  // offer the "Get instant results" setup nudge (the free headless path).
  const origin = describeSummarySource(tldw.source, tldw.sourceKind);
  if (origin) {
    menuItems.push({
      label: origin.label,
      title: origin.title,
      onClick: () => void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: origin.section }),
    });
  } else if (!currentDirectApiEnabled) {
    menuItems.push({
      label: "⚡ Get instant results",
      title: "Get summaries instantly from the free Gemini API: no tab opens, no waiting. Click to set it up.",
      onClick: () => void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "directapi" }),
    });
  }

  const overflowMenu = buildOverflowMenu(t, menuItems, cleanups);

  const head = buildPanelHead(t, headerControls, currentChannelInfo, true, true, [], [overflowMenu]);
  Object.assign(head.style, { marginBottom: "8px" });

  // --- body: summary always visible; clicking the panel toggles details ---
  const hasDetails = !!tldw.details;
  const body = document.createElement("div");

  const summaryRow = document.createElement("div");
  Object.assign(summaryRow.style, { display: "flex", alignItems: "flex-start", gap: "6px" });

  const summaryEl = document.createElement("div");
  summaryEl.textContent = tldw.summary;
  Object.assign(summaryEl.style, { fontSize: "13px", lineHeight: "1.5", color: t.text, flex: "1" });
  summaryRow.append(summaryEl);
  body.append(summaryRow);

  if (hasDetails) {
    const chevron = document.createElement("span");
    chevron.textContent = "▾";
    Object.assign(chevron.style, { fontSize: "11px", color: t.sub, flexShrink: "0", marginTop: "3px" });
    summaryRow.append(chevron);

    const detailsWrap = document.createElement("div");
    Object.assign(detailsWrap.style, {
      display: "grid", gridTemplateRows: "0fr",
      overflow: "hidden", transition: "grid-template-rows 0.2s ease",
    });
    const detailsInner = document.createElement("div");
    detailsInner.textContent = tldw.details!;
    Object.assign(detailsInner.style, {
      overflow: "hidden", paddingTop: "8px",
      fontSize: "13px", lineHeight: "1.55", color: t.sub,
    });
    detailsWrap.append(detailsInner);
    body.append(detailsWrap);

    let expanded = false;
    panel.style.cursor = "pointer";
    panel.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest("button, input, a, select")) {
        expanded = !expanded;
        detailsWrap.style.gridTemplateRows = expanded ? "1fr" : "0fr";
        chevron.textContent = expanded ? "▴" : "▾";
      }
    });
  }

  // --- tags row (F6-UI): active channel+video tags + add / remove / promote ---
  const tagsRow = buildTagsRow(t, vid, cleanups);

  // removeSummaryPanel() is the single removal path, so aggregate every teardown
  // (popover document listeners) onto the element and run them there — cheaper
  // than a per-panel MutationObserver just to notice this node leave.
  (panel as CleanablePanel).__tldwCleanup = () => { for (const fn of cleanups) fn(); };

  // The panel is summary-only: summary text + tags row + the "⋯" menu. No
  // engagement cue and no AI verdict pill.
  panel.append(head, body, tagsRow);
  return panel;
}


function showSummaryPanel(
  tldw: TldwSummary,
  videoId?: string | null,
): void {
  const host = panelHost();
  if (!host) return;

  const vid = videoId ?? currentVideoId();
  removeSummaryPanel();
  // A result landed — the run is no longer in flight (clears the timeout +
  // the inline button's "Analyzing…" cue, which setWatchButtonState("ready")
  // below replaces).
  endRunInFlight();
  const panel = buildSummaryPanel(tldw, vid);
  summaryPanel = panel;
  summaryPanelKind = "summary";
  host.prepend(summaryPanel);
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
    document.createTextNode(" — Every new video from this channel will automatically get an AI summary."),
  );

  const apiNote = document.createElement("div");
  Object.assign(apiNote.style, { marginBottom: "8px" });
  apiNote.textContent = "Each summary uses your Gemini API key. Free-tier keys include a generous daily quota.";

  const usageBtn = document.createElement("button");
  usageBtn.textContent = "View API usage →";
  Object.assign(usageBtn.style, {
    background: "transparent", border: "none", padding: "0",
    color: "#1a73e8", cursor: "pointer", fontSize: "13px",
    textDecoration: "underline", textUnderlineOffset: "2px",
  });
  usageBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    window.open("https://aistudio.google.com/apikey", "_blank");
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
  const res = reply as { ok?: boolean; error?: string; actionUrl?: string; noTranscript?: boolean } | undefined;
  if (res?.ok !== false || currentVideoId() !== vid || !runInFlight) return;
  endRunInFlight();
  showSummaryErrorPanel(res.error, res.actionUrl, { noTranscript: res.noTranscript });
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
  opts: { forceRun?: boolean; bypassCache?: boolean } = {},
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
  if (isUnsummarizableLive()) {
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
  currentDirectApiEnabled = !!(s?.useDirectApi as boolean) && !!(s?.geminiApiKey as string);

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
    showSummaryPanel({ ...entry.tldw, source: cachedSourceLabel(entry.profileName), sourceKind: "cache" }, vid);
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
        bypassCache: opts.bypassCache ?? false,
      });
      handleAskReply(vid, reply);
    } catch { /* best effort */ }
  };
  // Expose for the loading-timeout retry panel.
  currentSummarizeAction = startApiCall;

  const cacheResult = opts.bypassCache
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
  endRunInFlight();
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
    if (!isUnsummarizableLive()) return;
    log("live stream with no transcript: hiding TL;DW");
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
  pendingTagPromptVid = null;
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
navPollTimer = window.setInterval(onNavigate, 500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === "GET_TRANSCRIPT") {
    log("transcript requested");
    // Name the video the transcript is for, so the worker can refuse one that
    // doesn't match the video it is summarizing.
    const videoId = currentVideoId();
    void getTranscript().then((transcript) =>
      sendResponse({ transcript: currentVideoId() === videoId ? transcript : null, videoId }),
    );
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
    const msg = message as { tldw?: TldwSummary; source?: string; sourceKind?: SummarySourceKind; videoId?: string };
    const tldw = msg?.tldw;
    if (tldw?.summary) {
      const cur = currentVideoId();
      // A Direct-API call or tab-scrape can take many seconds; the user may have
      // navigated to a different video in this same tab meanwhile. If the
      // background told us which video this summary is FOR and it's no longer the
      // one on screen, drop it — rendering it would show the wrong summary AND
      // caching it under the current id would permanently poison that video's
      // cache. Fall back to current behavior only when no videoId was provided.
      if (msg.videoId && msg.videoId !== cur) {
        sendResponse({ ok: true });
        return false;
      }
      const vid = msg.videoId ?? cur;
      // The result for the on-screen video has arrived — end the in-flight state
      // here, unconditionally. showSummaryPanel's render can still bail if the
      // panel host is transiently missing (YouTube re-rendering #below), but the
      // run IS done and the summary is cached below; leaving runInFlight set would
      // strand the button on "Analyzing…" and fire a bogus 90s timeout error.
      endRunInFlight();
      showSummaryPanel({ ...tldw, source: msg.source, sourceKind: msg.sourceKind }, vid);
    }
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
    const msg = message as { videoId?: string; reason?: string; actionUrl?: string; noTranscript?: boolean };
    if (!msg.videoId || msg.videoId === currentVideoId()) {
      if (runInFlight || msg.noTranscript) {
        endRunInFlight();
        showSummaryErrorPanel(msg.reason, msg.actionUrl, { noTranscript: msg.noTranscript });
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

export {};
