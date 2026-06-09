/**
 * Runs on youtube.com watch pages (isolated world). It obtains the current
 * video's transcript and hands it to the background worker on request.
 *
 * Primary path: the MAIN-world interceptor (youtube-intercept.ts) wraps the
 * page's fetch and relays YouTube's own transcript responses here via
 * postMessage. We cache that. To make YouTube actually issue the request we
 * open its "Show transcript" panel — but we read the intercepted *data*, not
 * the rendered panel, so it survives UI redesigns, shadow DOM, virtualization,
 * and other extensions mutating the panel.
 *
 * Fallback path: if nothing is intercepted, we scrape whatever the panel
 * rendered (classic or modern markup).
 *
 * Only the currently-loaded video is visible here, so a right-clicked thumbnail
 * gets no transcript — the background worker handles that.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log("[TL;DW]", ...args);

const currentVideoId = (): string | null =>
  new URLSearchParams(location.search).get("v");

import {
  USER_RATING_LABELS,
  USER_RATING_SCALE,
  scoreToVerdict,
  userAvgToLabel,
} from "../lib/constants";
import type { SponsorWindowApi } from "../types";

// --- intercepted transcript cache ----------------------------------------

let captured: string | null = null;
let capturedVideoId: string | null = null;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as
    | { __tldw?: boolean; kind?: string; body?: unknown }
    | undefined;
  if (!data || data.__tldw !== true) return;

  const text =
    data.kind === "get_transcript"
      ? extractFromGetTranscript(data.body)
      : data.kind === "timedtext"
        ? extractFromTimedText(data.body)
        : null;

  if (text) {
    captured = text;
    capturedVideoId = currentVideoId();
    log("intercepted transcript:", text.length, "chars");
  }
});

function cachedForCurrentVideo(): string | null {
  return captured && capturedVideoId === currentVideoId() ? captured : null;
}

// --- parsing YouTube's transcript payloads -------------------------------

type SnippetLike = { simpleText?: string; runs?: { text?: string }[] };

function snippetText(snippet: SnippetLike | undefined): string {
  if (typeof snippet?.simpleText === "string") return snippet.simpleText;
  if (Array.isArray(snippet?.runs)) {
    return snippet.runs.map((r) => r?.text ?? "").join("");
  }
  return "";
}

/** Walk the get_transcript InnerTube JSON, collecting every segment's text. */
function extractFromGetTranscript(root: unknown): string | null {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const seg = record.transcriptSegmentRenderer as
      | { snippet?: SnippetLike }
      | undefined;
    if (seg?.snippet) {
      const text = snippetText(seg.snippet);
      if (text) parts.push(text);
    }
    for (const key in record) visit(record[key]);
  };
  visit(root);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 20 ? text : null;
}

/** Parse a timedtext response — either json3 or the legacy XML. */
function extractFromTimedText(body: unknown): string | null {
  if (typeof body !== "string" || !body) return null;

  if (body.trimStart().startsWith("{")) {
    try {
      const json = JSON.parse(body) as {
        events?: { segs?: { utf8?: string }[] }[];
      };
      const text = (json.events ?? [])
        .flatMap((e) => e.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      return text.length > 20 ? text : null;
    } catch {
      return null;
    }
  }

  const parts: string[] = [];
  for (const m of body.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    parts.push(decodeEntities(m[1]));
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 20 ? text : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

function findShowTranscriptButton(): HTMLElement | null {
  const section = document.querySelector(
    "ytd-video-description-transcript-section-renderer",
  );
  const sectionBtn = section?.querySelector<HTMLElement>("button");
  if (sectionBtn) return sectionBtn;

  for (const el of document.querySelectorAll<HTMLElement>("button[aria-label]")) {
    if (/transcript/i.test(el.getAttribute("aria-label") ?? "")) return el;
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    "button, ytd-button-renderer, tp-yt-paper-button, yt-button-shape",
  )) {
    if (/^show transcript$/i.test(el.textContent?.trim() ?? "")) return el;
  }
  return null;
}

// --- DOM scrape fallback --------------------------------------------------

function joinLines(lines: string[]): string | null {
  if (lines.length === 0) return null;
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** Strip a leading "1:23" / "1:02:03" timestamp from a segment's text. */
function stripTimestamp(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim();
}

function scrapeRenderedTranscript(): string | null {
  // Modern view-model panel (transcript-segment-view-model). The whole
  // transcript renders at once, so one query gets every line.
  const modern = document.querySelectorAll(
    "transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost",
  );
  if (modern.length > 0) {
    const lines: string[] = [];
    modern.forEach((seg) => {
      const text = stripTimestamp(seg.textContent ?? "");
      if (text) lines.push(text);
    });
    const joined = joinLines(lines);
    if (joined) return joined;
  }

  // Classic discrete segment elements.
  for (const selector of [
    "ytd-transcript-segment-renderer",
    "ytd-transcript-segment-list-renderer .segment",
  ]) {
    const segments = document.querySelectorAll(selector);
    if (segments.length === 0) continue;
    const lines: string[] = [];
    segments.forEach((segment) => {
      const text =
        segment.querySelector(".segment-text")?.textContent?.trim() ??
        stripTimestamp(segment.textContent ?? "");
      if (text) lines.push(text);
    });
    const joined = joinLines(lines);
    if (joined) return joined;
  }
  return null;
}

// --- request handling -----------------------------------------------------

/** Either source: intercepted network data, or the rendered panel. */
function available(): string | null {
  return cachedForCurrentVideo() ?? scrapeRenderedTranscript();
}

/** The transcript engagement panel element, if present. */
function transcriptPanelEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
  );
}

/** Whether YouTube's transcript panel is currently open. */
function transcriptPanelOpen(): boolean {
  const panel = transcriptPanelEl();
  if (panel) {
    return panel.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
  }
  const seg = document.querySelector<HTMLElement>("ytd-transcript-segment-renderer");
  return !!(seg && seg.offsetParent !== null);
}

/** Collapse the transcript panel (best-effort) — used to undo a panel we opened. */
function closeTranscriptPanel(): void {
  const panel = transcriptPanelEl();
  const closeBtn =
    panel?.querySelector<HTMLElement>("#visibility-button button") ??
    panel?.querySelector<HTMLElement>('button[aria-label*="lose" i]') ??
    null;
  if (closeBtn) {
    log("closing transcript panel we opened");
    closeBtn.click();
    return;
  }
  findShowTranscriptButton()?.click();
}

/**
 * Open YouTube's transcript panel so its segments render (and any fetch fires).
 * Returns whether *we* opened it, so the caller can close it again afterward
 * without disturbing a panel the user had already open.
 */
async function openTranscriptPanel(): Promise<{ openedByUs: boolean; expandedByUs: boolean }> {
  if (transcriptPanelOpen()) return { openedByUs: false, expandedByUs: false };
  const expandedByUs = expandDescription();
  let button: HTMLElement | null = null;
  const buttonDeadline = Date.now() + 4000;
  while (Date.now() < buttonDeadline) {
    button = findShowTranscriptButton();
    if (button) break;
    await sleep(200);
  }
  if (button) {
    log("opening transcript panel");
    button.click();
    return { openedByUs: true, expandedByUs };
  }
  log("no 'Show transcript' button found");
  return { openedByUs: false, expandedByUs };
}

// Serialises concurrent calls so only one panel-open attempt runs at a time.
let activeTranscriptFetch: Promise<string | null> | null = null;

async function getTranscript(): Promise<string | null> {
  const immediate = available();
  if (immediate) {
    log("transcript ready:", immediate.length, "chars");
    return immediate;
  }

  if (activeTranscriptFetch) return activeTranscriptFetch;

  activeTranscriptFetch = (async () => {
    const { openedByUs, expandedByUs } = await openTranscriptPanel();
    // Leave the page as we found it: collapse the panel AND the description if
    // *we* opened/expanded them. A panel/description the user already had open
    // is left untouched.
    const restore = () => {
      if (openedByUs) closeTranscriptPanel();
      if (expandedByUs) collapseDescription();
    };
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await sleep(300);
      const hit = available();
      if (hit) {
        restore();
        log("transcript captured:", hit.length, "chars");
        return hit;
      }
    }
    restore();
    log("no transcript captured");
    return null;
  })();

  try {
    return await activeTranscriptFetch;
  } finally {
    activeTranscriptFetch = null;
  }
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
 * stream, which becomes an ordinary VOD with a transcript). The player's red
 * "LIVE" badge is only shown while the stream is ongoing and disappears once it
 * ends; non-DVR live also reports an infinite media duration.
 */
function isActivelyLive(): boolean {
  const badge = document.querySelector<HTMLElement>(".ytp-live-badge");
  if (badge && badge.offsetParent !== null) return true;
  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
  if (video && video.duration === Infinity) return true;
  return false;
}

/**
 * Cheap, synchronous check for whether a transcript exists for this video —
 * either our fetch-interceptor already captured one, or YouTube is offering its
 * "Show transcript" affordance. Recorded live streams have transcripts; an
 * in-progress broadcast does not. We never pull the full transcript just to
 * answer this.
 */
function transcriptLikelyAvailable(): boolean {
  return !!(cachedForCurrentVideo() || findShowTranscriptButton());
}

/**
 * Suppress the summary UI only when the stream is live AND we can't find a
 * transcript — so a finished/recorded live stream (transcript present) is still
 * summarizable, while a genuinely in-progress broadcast is not.
 */
function isUnsummarizableLive(): boolean {
  return isActivelyLive() && !transcriptLikelyAvailable();
}

/** Read the current video's duration (seconds), channel name, and channel avatar URL. */
function getVideoMeta(): { durationSeconds: number; channel: string; avatarUrl?: string } {
  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
  let durationSeconds =
    video && Number.isFinite(video.duration) ? video.duration : 0;
  if (!durationSeconds) {
    durationSeconds = hmsToSeconds(
      document.querySelector(".ytp-time-duration")?.textContent,
    );
  }
  const channel =
    document
      .querySelector(
        "ytd-channel-name a, #owner #channel-name a, ytd-video-owner-renderer a.yt-simple-endpoint",
      )
      ?.textContent?.trim() ?? "";
  const avatarUrl =
    document.querySelector<HTMLImageElement>(
      "ytd-video-owner-renderer #avatar img, #owner yt-img-shadow img, ytd-video-owner-renderer yt-img-shadow img",
    )?.src ?? undefined;
  return { durationSeconds, channel, avatarUrl };
}

// --- comment scraping ----------------------------------------------------

/**
 * Scrolls the comments section into view, waits up to 2 s for comment
 * elements to render, and returns up to 20 comments as a formatted string.
 * Returns null if no comments are found within the timeout.
 */
async function getTopComments(): Promise<string | null> {
  const commentsEl = document.querySelector<HTMLElement>("ytd-comments#comments");
  if (!commentsEl) return null;

  // Scroll into view to trigger YouTube's lazy comment load.
  commentsEl.scrollIntoView({ behavior: "instant", block: "start" });

  // Poll for comment thread renderers up to 5 s.
  const deadline = Date.now() + 5000;
  let threads: NodeListOf<Element> | null = null;
  while (Date.now() < deadline) {
    threads = document.querySelectorAll("ytd-comment-thread-renderer");
    if (threads.length > 0) break;
    await sleep(100);
  }

  // Scroll back to top so the user isn't disoriented.
  window.scrollTo({ top: 0, behavior: "instant" });

  if (!threads || threads.length === 0) return null;

  const comments: string[] = [];
  const limit = Math.min(threads.length, 20);
  for (let i = 0; i < limit; i++) {
    const thread = threads[i];
    const textEl =
      thread.querySelector<HTMLElement>("#content-text") ??
      thread.querySelector<HTMLElement>("yt-attributed-string") ??
      thread.querySelector<HTMLElement>(".ytd-comment-renderer");
    const text = textEl?.textContent?.trim().replace(/\s+/g, " ");
    if (!text) continue;

    const likeEl =
      thread.querySelector<HTMLElement>("#vote-count-middle") ??
      thread.querySelector<HTMLElement>("span[aria-label]");
    const likes = likeEl?.textContent?.trim();
    comments.push(likes ? `${text} [${likes} likes]` : text);
  }

  return comments.length > 0 ? comments.join("\n") : null;
}

// --- auto-run / blocked channel helpers (direct storage; no lib imports in content script) --

const AUTO_RUN_CHANNELS_KEY = "autoRunChannels";
const BLOCKED_CHANNELS_KEY = "tldwBlockedChannels";
const BLOCKED_COMMENTS_KEY = "tldwBlockedCommentsChannels";
const TLDW_COMMENTS_PANEL_ID = "tldw-comments-panel";

type AutoRunChannelEntry = {
  id: string; name: string; avatarUrl: string; addedAt: string;
  autoRunSummary: boolean; autoRunComments: boolean;
};

type BlockedChannelEntry = { id: string; name: string; avatarUrl: string; addedAt: string };

async function readBlockedChannels(): Promise<BlockedChannelEntry[]> {
  const r = await chrome.storage.local.get(BLOCKED_CHANNELS_KEY);
  return (r[BLOCKED_CHANNELS_KEY] as BlockedChannelEntry[]) ?? [];
}

async function clearCachedSummariesForChannel(channelName: string): Promise<void> {
  const r = await chrome.storage.local.get("tldwSummaryCache");
  const cache = (r["tldwSummaryCache"] as Record<string, { channelName?: string }>) ?? {};
  const updated: Record<string, unknown> = {};
  for (const [vid, entry] of Object.entries(cache)) {
    if (entry.channelName !== channelName) updated[vid] = entry;
  }
  await chrome.storage.local.set({ tldwSummaryCache: updated });
}

async function addBlockedChannelEntry(info: ChannelInfo): Promise<void> {
  const existing = await readBlockedChannels();
  const filtered = existing.filter((c) => c.id !== info.id && c.name !== info.name);
  const entry: BlockedChannelEntry = { ...info, addedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [BLOCKED_CHANNELS_KEY]: [entry, ...filtered] });
  await clearCachedSummariesForChannel(info.name);
}

async function addBlockedCommentsChannelEntry(info: ChannelInfo): Promise<void> {
  const r = await chrome.storage.local.get(BLOCKED_COMMENTS_KEY);
  const existing = (r[BLOCKED_COMMENTS_KEY] as BlockedChannelEntry[]) ?? [];
  const filtered = existing.filter((c) => c.id !== info.id && c.name !== info.name);
  const entry: BlockedChannelEntry = { ...info, addedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [BLOCKED_COMMENTS_KEY]: [entry, ...filtered] });
}

async function readAutoRunChannels(): Promise<AutoRunChannelEntry[]> {
  const r = await chrome.storage.local.get(AUTO_RUN_CHANNELS_KEY);
  const raw = (r[AUTO_RUN_CHANNELS_KEY] as Partial<AutoRunChannelEntry>[]) ?? [];
  return raw.map((c) => ({ autoRunSummary: true, autoRunComments: false, ...c } as AutoRunChannelEntry));
}

async function writeAutoRunChannel(info: ChannelInfo, field: "summary" | "comments", enable: boolean): Promise<void> {
  const channels = await readAutoRunChannels();
  const existing = channels.find((c) => c.id === info.id || c.name === info.name);
  let updated: AutoRunChannelEntry[];
  if (existing) {
    const patched: AutoRunChannelEntry = {
      ...existing,
      avatarUrl: info.avatarUrl, // refresh avatar on each visit
      autoRunSummary: field === "summary" ? enable : existing.autoRunSummary,
      autoRunComments: field === "comments" ? enable : existing.autoRunComments,
    };
    if (!patched.autoRunSummary && !patched.autoRunComments) {
      updated = channels.filter((c) => c.id !== existing.id);
    } else {
      updated = channels.map((c) => (c.id === existing.id ? patched : c));
    }
  } else if (enable) {
    updated = [{
      id: info.id, name: info.name, avatarUrl: info.avatarUrl,
      addedAt: new Date().toISOString(),
      autoRunSummary: field === "summary",
      autoRunComments: field === "comments",
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

/** The current video's clean watch URL (drops ?t=, &pp=, etc.) for history storage. */
function currentWatchUrl(): string {
  const vid = currentVideoId();
  return vid ? `https://www.youtube.com/watch?v=${vid}` : location.href;
}

/** The current video's title from the watch metadata, falling back to the cleaned page title. */
function currentVideoTitle(): string | undefined {
  const h1 =
    document.querySelector<HTMLElement>("ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1")
      ?.textContent?.trim();
  if (h1) return h1;
  // Fall back to the tab title: drop unread "(3) " prefix and " - YouTube" suffix.
  const docTitle = document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "").trim();
  return docTitle || undefined;
}

// Module-level state so the SET_SUMMARY handler can use the same channel context
// as the initial maybeStartDirectApiRun call.
let currentChannelInfo: ChannelInfo | null = null;
let currentAutoRunSummary = false;
let currentAutoRunComments = false;

// --- TL;DW summary panel -------------------------------------------------

type TldwSummary = { verdict: string; summary: string; rating: string; details?: string; source?: string };

let summaryPanel: HTMLElement | null = null;
// Which kind of panel is currently injected into the host. Drives mutual
// exclusion with the standalone rating bar:
//  - "summary": a real summary, owns the rating row → bar hidden.
//  - "loading": skeleton while the API call is in flight → bar hidden (the
//    summary that replaces it owns the rating).
//  - "idle": the "Get Summary" placeholder, no rating row → bar shown alongside.
//  - null: no panel → bar shown.
let summaryPanelKind: "summary" | "loading" | "idle" | null = null;

// The current "run a summary" action, captured so the loading-timeout error
// panel can offer a one-click Retry. Set whenever the idle/loading flow runs.
let currentSummarizeAction: (() => Promise<void>) | null = null;
// Fires if a loading panel sits unfilled too long (a tab-scrape that never
// returned, a dead API call). Cleared whenever the panel is replaced/removed.
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

function removeSummaryPanel(): void {
  clearLoadingTimeout();
  summaryPanel?.remove();
  summaryPanel = null;
  summaryPanelKind = null;
}

// --- TL;DW comments panel (injected into ytd-comments-header-renderer) ----

let commentsObserver: MutationObserver | null = null;
/** Pending sentiment to apply as soon as the comments section appears in the DOM. */
let pendingCommentSentiment: { sentiment: string; audienceScore?: number } | null = null;

/**
 * Returns a stable injection target for the comments card — the PARENT of
 * ytd-comments#comments, not inside it. YouTube re-renders the inside of
 * ytd-comments as threads lazy-load, which would wipe any panel injected there.
 * Inserting before ytd-comments itself sits in a stable container.
 */
function commentsCardTarget(): { container: Element; referenceNode: Element } | null {
  const comments = document.querySelector("ytd-comments#comments");
  if (!comments?.parentElement) return null;
  return { container: comments.parentElement, referenceNode: comments };
}

/** Still used by watchForCommentsSection to detect when comments section appears. */
function commentsHeaderHost(): Element | null {
  return document.querySelector("ytd-comments-header-renderer");
}

function removeCommentsPanel(): void {
  document.getElementById(TLDW_COMMENTS_PANEL_ID)?.remove();
}

function theme(): { bg: string; border: string; text: string; sub: string; hover: string } {
  const dark = document.documentElement.hasAttribute("dark");
  return dark
    ? { bg: "#212121", border: "#3f3f3f", text: "#f1f1f1", sub: "#aaaaaa", hover: "#383838" }
    : { bg: "#ffffff", border: "#e5e5e5", text: "#0f0f0f", sub: "#606060", hover: "#f2f2f2" };
}

function verdictColor(verdict: string): string {
  if (verdict === "SKIP") return "#dc2626";
  if (verdict === "SKIM") return "#d97706";
  return "#16a34a"; // WATCH
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - 30);
  const g = Math.max(0, ((n >> 8) & 0xff) - 30);
  const b = Math.max(0, (n & 0xff) - 30);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Uniform geometry shared by every injected pill-shaped control (rating
 * buttons, skip-channel, auto toggles, verdict/score pills, Get Summary, …).
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

function pill(text: string, bg: string, color: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = text;
  Object.assign(el.style, {
    background: bg,
    color,
    fontWeight: "700",
    fontSize: "11px",
    letterSpacing: "0.05em",
    padding: "0 11px",
    borderRadius: "999px",
    flexShrink: "0",
    whiteSpace: "nowrap",
    ...pillGeom,
  });
  return el;
}

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

// --- auto-run pill toggle (shared by all panel states) -----------------------

/**
 * A small pill button in the panel header that shows/toggles auto-run state
 * for either summary or comments. Color reflects current state.
 */
function buildAutoToggle(
  info: ChannelInfo,
  field: "summary" | "comments",
  initialOn: boolean,
  t: ReturnType<typeof theme>,
): HTMLButtonElement {
  // OFF state reads as the offer ("turn it on"); ON state reads as a clear,
  // unmistakable red STOP so it never looks like "nothing changed".
  const offLabel = field === "summary" ? "↻ Auto-summarize" : "💬 Auto analyze";
  const onLabel = field === "summary" ? "■ Stop auto-summarize" : "■ Stop auto analyze";
  const enableColor = field === "summary" ? "#1a73e8" : "#0d9488"; // feature color, used as OFF-hover preview
  const STOP_COLOR = "#dc2626";

  const btn = document.createElement("button");
  Object.assign(btn.style, {
    fontSize: "13px", fontWeight: "700", letterSpacing: "0.04em",
    padding: "0 12px", borderRadius: "999px", border: "none",
    cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
    transition: "background 0.15s, color 0.15s",
    ...pillGeom,
  });

  let isOn = initialOn;
  const applyState = (on: boolean) => {
    isOn = on;
    btn.textContent = on ? onLabel : offLabel;
    btn.style.background = on ? STOP_COLOR : t.border;
    btn.style.color = on ? "#fff" : t.sub;
    btn.title = on
      ? `Auto-run ${field} is ON for ${info.name} — click to stop`
      : `Turn on auto-run ${field} for ${info.name}`;
  };

  applyState(initialOn);

  btn.addEventListener("mouseenter", () => {
    // OFF → preview the feature color ("click to enable"); ON → darken red ("click to stop").
    btn.style.background = isOn ? darken(STOP_COLOR) : enableColor;
    btn.style.color = "#fff";
    btn.style.opacity = "1";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.opacity = "1";
    applyState(isOn);
  });

  let busy = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (busy) return;
    const current = field === "summary" ? currentAutoRunSummary : currentAutoRunComments;
    const enabling = !current;
    if (enabling) {
      busy = true;
      showAutoRunConfirmOverlay(info, field, () => {
        if (field === "summary") currentAutoRunSummary = true;
        else currentAutoRunComments = true;
        applyState(true);
        void writeAutoRunChannel(info, field, true).finally(() => { busy = false; });
      }, () => { busy = false; });
      return;
    }
    busy = true;
    if (field === "summary") currentAutoRunSummary = false;
    else currentAutoRunComments = false;
    applyState(false);
    void writeAutoRunChannel(info, field, false).finally(() => { busy = false; });
  });

  return btn;
}

/** Shared header row builder used by all panel states. */
function buildPanelHead(
  t: ReturnType<typeof theme>,
  controls: HTMLElement[],
  channelInfo: ChannelInfo | null,
  showBlockBtn = true,
  showAutoRunToggle = true,
  showTitle = true,
  rightControls: HTMLElement[] = [],
): HTMLElement {
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "7px" });

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(icon.style, { width: "28px", height: "28px", borderRadius: "6px", flexShrink: "0" });

  const title = document.createElement("span");
  title.textContent = "TL;DW";
  Object.assign(title.style, { fontWeight: "700", fontSize: "15px", color: t.text, flexShrink: "0" });

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

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
    // Panel dismissed — fall back to the standalone rating bar (gated inside).
    void maybeShowStandaloneRatingBar();
  });

  const autoToggles: HTMLElement[] = [];
  if (channelInfo && showAutoRunToggle) {
    autoToggles.push(buildAutoToggle(channelInfo, "summary", currentAutoRunSummary, t));
  }

  const blockBtn = (showBlockBtn && channelInfo) ? buildBlockButton(t, channelInfo) : null;
  closeBtn.style.marginLeft = "12px";
  // Right cluster order: extra right controls (e.g. Clear · Gemini) · Skip channel · Auto-summarize · ✕
  head.append(
    icon,
    ...(showTitle ? [title] : []),
    ...controls,
    spacer,
    ...rightControls,
    ...(blockBtn ? [blockBtn] : []),
    ...autoToggles,
    closeBtn,
  );
  return head;
}

// --- SponsorBlock section (data + undo supplied by sponsorblock.ts via window) ---

const SPONSOR_SECTION_ID = "tldw-sponsor-section";

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
 * The SponsorBlock row shown inside the panel: each sponsor segment's timestamp
 * range, with a persistent per-segment Undo once it's been auto-skipped.
 */
function buildSponsorSection(t: ReturnType<typeof theme>): HTMLElement | null {
  const segs = sponsorApi()?.getSegments() ?? [];
  if (segs.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.id = SPONSOR_SECTION_ID;
  Object.assign(wrap.style, {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px",
    marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${t.border}`,
    fontSize: "12px", color: t.sub,
  });

  const label = document.createElement("span");
  label.textContent = "⏭ SponsorBlock";
  Object.assign(label.style, { fontWeight: "700", flexShrink: "0" });
  wrap.append(label);

  for (const seg of segs) {
    const chip = document.createElement("span");
    Object.assign(chip.style, {
      display: "inline-flex", alignItems: "center", gap: "6px",
      background: t.border, borderRadius: "999px", padding: "2px 9px",
      whiteSpace: "nowrap", color: t.text,
    });

    const range = document.createElement("span");
    const active = seg.skipped && !seg.disabled;
    range.textContent = `${active ? "✓ " : ""}${secToClock(seg.start)}–${secToClock(seg.end)}`;
    if (active) range.style.color = t.sub;
    chip.append(range);

    if (active) {
      const undo = document.createElement("button");
      undo.textContent = "Undo";
      Object.assign(undo.style, {
        background: "transparent", border: "none", color: "#1a73e8",
        cursor: "pointer", fontWeight: "700", fontSize: "12px", padding: "0",
      });
      undo.addEventListener("click", (e) => {
        e.stopPropagation();
        sponsorApi()?.undo(seg.index);
      });
      chip.append(undo);
    }
    wrap.append(chip);
  }
  return wrap;
}

/** Insert/refresh the SponsorBlock section as the panel's second child. */
function refreshSponsorPanel(): void {
  const panel = summaryPanel;
  if (!panel) return;
  panel.querySelector(`#${SPONSOR_SECTION_ID}`)?.remove();
  const section = buildSponsorSection(theme());
  if (!section) return;
  const head = panel.querySelector<HTMLElement>(":scope > div");
  if (head && head.nextSibling) panel.insertBefore(section, head.nextSibling);
  else panel.append(section);
}

// sponsorblock.ts fires this whenever segments are fetched, skipped, or undone.
window.addEventListener("tldw-sponsor-update", refreshSponsorPanel);

/** Block button — hides the panel permanently for this channel on this and future visits. */
function buildBlockButton(t: ReturnType<typeof theme>, info: ChannelInfo): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = "⊘ Skip channel";
  btn.title = `Never show TL;DW panel for ${info.name}`;
  Object.assign(btn.style, {
    fontSize: "13px", fontWeight: "700", letterSpacing: "0.04em",
    padding: "0 12px", borderRadius: "999px", border: "none",
    cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
    transition: "background 0.15s, color 0.15s",
    background: t.border, color: t.sub,
    ...pillGeom,
  });
  btn.addEventListener("mouseenter", () => { btn.style.background = "#dc2626"; btn.style.color = "#fff"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = t.border; btn.style.color = t.sub; });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    showSkipOverlay(info.name, info, "summary", () => { /* panel stays open */ });
  });
  return btn;
}

/** "⚡ Gemini" header link that deep-links to the Direct API options section. */
function buildGeminiLink(t: ReturnType<typeof theme>, label = "⚡ Gemini"): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  Object.assign(b.style, {
    fontSize: "13px", color: t.sub, background: "transparent", border: "none",
    cursor: "pointer", padding: "0", whiteSpace: "nowrap",
  });
  b.title = "Open Direct API settings";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "directapi" });
  });
  return b;
}

/**
 * Compact "Your rating:" + Engaged/Skimmed/Skipped row for the loading panel, so
 * the user can vote while the summary is still in flight. Any prior vote loads
 * in pre-selected a tick later; the arriving summary panel then owns the rating.
 */
function buildLoadingRatingRow(t: ReturnType<typeof theme>, vid: string | null): HTMLElement {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    borderTop: `1px solid ${t.border}`, marginTop: "10px", paddingTop: "9px",
    display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
  });
  const label = document.createElement("span");
  label.textContent = "Your rating:";
  Object.assign(label.style, { fontSize: "13px", color: t.sub, fontWeight: "700", flexShrink: "0" });
  wrap.append(label);
  const mount = (initial: "watch" | "skim" | "skip" | undefined) =>
    wrap.append(buildRatingButtonsRow(t, initial, vid));
  if (vid) void loadPriorUserRating(vid).then(mount).catch(() => mount(undefined));
  else mount(undefined);
  return wrap;
}

/** Show an instant skeleton panel while the API call is in flight. */
function showLoadingPanel(): void {
  const host = panelHost();
  if (!host) return;
  removeSummaryPanel();
  ensureShimmerStyle();

  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
  });

  const analyzing = document.createElement("span");
  analyzing.textContent = "Analyzing…";
  Object.assign(analyzing.style, { fontSize: "12px", color: t.sub, animation: "tldw-shimmer 1.4s infinite" });

  // Keep the ⚡ Gemini link visible during loading (it's part of what's running).
  const head = buildPanelHead(t, [analyzing], currentChannelInfo, true, false, true, [buildGeminiLink(t)]);
  Object.assign(head.style, { marginBottom: "10px" });

  const shimmerLine = (width: string) => {
    const d = document.createElement("div");
    Object.assign(d.style, {
      background: t.border, borderRadius: "4px", height: "13px",
      width, marginBottom: "8px", animation: "tldw-shimmer 1.4s infinite",
    });
    return d;
  };

  // Show what we're voting on while the summary loads — the rating row is live.
  panel.append(head, shimmerLine("90%"), shimmerLine("65%"), buildLoadingRatingRow(t, currentVideoId()));

  removeStandaloneRatingBar();
  summaryPanel = panel;
  summaryPanelKind = "loading";
  host.prepend(panel);
  log("loading panel shown");
  refreshSponsorPanel();

  // Don't let the skeleton spin forever (e.g. a tab-mode scrape that never
  // produced a parseable answer). After a grace period, surface a retry panel.
  clearLoadingTimeout();
  const loadingVid = currentVideoId();
  loadingTimeoutTimer = window.setTimeout(() => {
    if (summaryPanelKind === "loading" && currentVideoId() === loadingVid) {
      showSummaryErrorPanel();
    }
  }, LOADING_TIMEOUT_MS);
}

/**
 * Shown when a loading panel times out — the API call or the tab-mode scrape
 * never returned a usable summary. Offers a one-click retry and explains the
 * tab-mode caveat so the user isn't left staring at a dead skeleton.
 */
function showSummaryErrorPanel(): void {
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

  const head = buildPanelHead(t, [], currentChannelInfo, false, false, true, [retryBtn]);
  Object.assign(head.style, { marginBottom: "8px" });

  const msg = document.createElement("div");
  msg.textContent =
    "Couldn't get the summary back in time. If you're using the tab flow (no API key), " +
    "the destination tab may still be working or may need a sign-in — check it, then retry.";
  Object.assign(msg.style, { fontSize: "13px", lineHeight: "1.5", color: t.sub });

  panel.append(head, msg);
  summaryPanel = panel;
  summaryPanelKind = "idle";
  host.prepend(panel);
  log("summary error panel shown (loading timed out)");
  refreshSponsorPanel();
}

type ChannelComparison = {
  avgAiRating: number | null;
  avgAudienceScore: number | null;
  count: number;
  avgUserRating: number | null;
  userBreakdown?: { engaged: number; skimmed: number; skipped: number };
};

/** The five rating-dimension toggles read from settings when building the panel. */
type RatingToggles = {
  showAiRecommendation: boolean;
  trackAiAverage: boolean;
  askForMyRating: boolean;
  trackMyAverage: boolean;
  includeCommentSentiment: boolean;
  trackCommunityAverage: boolean;
};

const DEFAULT_RATING_TOGGLES: RatingToggles = {
  showAiRecommendation: true,
  trackAiAverage: true,
  askForMyRating: true,
  trackMyAverage: true,
  includeCommentSentiment: false,
  trackCommunityAverage: true,
};

/**
 * Compute the per-channel comparison averages from stored history for one
 * channel. Mirrors computeChannelStats in lib/history.ts but inline (this
 * content script has no imports). Returns undefined when the channel has no
 * history yet.
 */
async function computeChannelComparison(
  channelName: string | undefined,
): Promise<ChannelComparison | undefined> {
  if (!channelName) return undefined;
  const r = await chrome.storage.local.get("history");
  type HistEntry = {
    channel?: string;
    aiRating?: number;
    audienceScore?: number;
    userRating?: "watch" | "skim" | "skip";
  };
  const history = (r["history"] as HistEntry[]) ?? [];
  const videos = history.filter((h) => h.channel === channelName);
  if (videos.length < 1) return undefined;

  const ai = videos.map((v) => v.aiRating).filter((n): n is number => n !== undefined);
  const aud = videos.map((v) => v.audienceScore).filter((n): n is number => n !== undefined);
  const usr = videos
    .map((v) => v.userRating)
    .filter((v): v is "watch" | "skim" | "skip" => v !== undefined);
  const userBreakdown = { engaged: 0, skimmed: 0, skipped: 0 };
  for (const v of usr) {
    if (v === "watch") userBreakdown.engaged++;
    else if (v === "skim") userBreakdown.skimmed++;
    else userBreakdown.skipped++;
  }
  return {
    count: videos.length,
    avgAiRating: ai.length ? ai.reduce((a, b) => a + b, 0) / ai.length : null,
    avgAudienceScore: aud.length ? aud.reduce((a, b) => a + b, 0) / aud.length : null,
    avgUserRating: usr.length ? usr.reduce((a, b) => a + USER_RATING_SCALE[b], 0) / usr.length : null,
    userBreakdown,
  };
}

/** Read the rating-dimension toggles from settings (defaults mirror DEFAULT_SETTINGS). */
async function loadRatingToggles(): Promise<RatingToggles> {
  const r = await chrome.storage.local.get("settings");
  const s = (r["settings"] as Partial<RatingToggles> | undefined) ?? {};
  return {
    showAiRecommendation: s.showAiRecommendation ?? true,
    trackAiAverage: s.trackAiAverage ?? true,
    askForMyRating: s.askForMyRating ?? true,
    trackMyAverage: s.trackMyAverage ?? true,
    includeCommentSentiment: s.includeCommentSentiment ?? false,
    trackCommunityAverage: s.trackCommunityAverage ?? true,
  };
}

function buildSummaryPanel(
  tldw: TldwSummary,
  channelStats?: ChannelComparison,
  initialUserRating?: "watch" | "skim" | "skip",
  videoId?: string | null,
  toggles: RatingToggles = DEFAULT_RATING_TOGGLES,
  audienceScore?: number,
): HTMLElement {
  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif", color: t.text,
  });

  // --- header: AI verdict pill + source ---
  // AI dimension collect/show gate: when off, omit the verdict pill entirely
  // (the one-line summary stands alone). No numeric score is shown anywhere.
  const headerControls: HTMLElement[] = [];

  // Parse the numeric AI rating (e.g. "8/10" → 8) — used only to drive the
  // directional ▲/▼/≈ cue against the channel average. No numeric pill is shown;
  // the AI verdict itself is the visible value.
  const aiMatch = tldw.rating ? /^(\d+)/.exec(tldw.rating) : null;
  const aiThisVideo = aiMatch ? parseInt(aiMatch[1], 10) : null;

  if (toggles.showAiRecommendation) {
    headerControls.push(pill(tldw.verdict, verdictColor(tldw.verdict), "#fff"));
  }

  // Right-cluster controls (built below, placed on the right of the header):
  // 🗑 Clear cached summary · ⚡ Gemini.
  const rightControls: HTMLElement[] = [];

  let srcBtn: HTMLElement | null = null;
  if (tldw.source) {
    srcBtn = document.createElement("button");
    srcBtn.textContent = `⚡ ${tldw.source}`;
    Object.assign(srcBtn.style, {
      fontSize: "13px", color: t.sub, background: "transparent", border: "none",
      cursor: "pointer", padding: "0", whiteSpace: "nowrap",
    });
    srcBtn.title = "Open Direct API settings";
    srcBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "directapi" });
    });
  }

  // Per-video "Clear cached summary": drops THIS video's entry from
  // tldwSummaryCache, removes the panel, and reverts to the idle/pre-summary
  // state (re-running maybeStartDirectApiRun with no cache entry shows the idle
  // "Get Summary" panel, or auto-runs if the channel opted in). The standalone
  // rating bar from Feature 1 reappears since the summary panel is gone.
  {
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "🗑 Clear cached summary";
    clearBtn.title = "Remove this video's cached summary and start fresh";
    Object.assign(clearBtn.style, {
      fontSize: "13px", color: t.sub, background: "transparent", border: "none",
      cursor: "pointer", padding: "0", whiteSpace: "nowrap",
    });
    clearBtn.addEventListener("mouseenter", () => { clearBtn.style.color = "#dc2626"; });
    clearBtn.addEventListener("mouseleave", () => { clearBtn.style.color = t.sub; });
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const vid = videoId ?? currentVideoId();
      void chrome.storage.local.get("tldwSummaryCache").then((r) => {
        const cache = (r["tldwSummaryCache"] as Record<string, unknown>) ?? {};
        if (vid && cache[vid]) {
          delete cache[vid];
          return chrome.storage.local.set({ tldwSummaryCache: cache });
        }
      }).finally(() => {
        removeSummaryPanel();
        // Re-run the Direct-API flow: with the cache entry gone it lands on the
        // idle panel (or auto-run). The standalone bar is re-injected after.
        void maybeStartDirectApiRun().finally(() => { void maybeShowStandaloneRatingBar(); });
      });
    });
    // Order: 🗑 Clear · ⚡ Gemini (then Skip channel · Auto-summarize · ✕ from buildPanelHead).
    rightControls.push(clearBtn);
    if (srcBtn) rightControls.push(srcBtn);
  }

  const head = buildPanelHead(t, headerControls, currentChannelInfo, true, true, true, rightControls);
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

  // --- channel comparison row: one cue per dimension, gated by track toggles ---
  // Each cue shows the channel average plus a ▲/▼/≈ marker comparing this video's
  // value to that average. The "My" cue is updated live when the user rates.
  const channelRow = document.createElement("div");
  Object.assign(channelRow.style, {
    borderTop: `1px solid ${t.border}`,
    marginTop: "8px", paddingTop: "7px",
    fontSize: "12px", color: t.sub,
    display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center",
  });

  const dimEls: HTMLElement[] = [];

  /**
   * Build/refresh one dimension cue, expressed entirely in words:
   * "<label>: usually <VERDICT> <▲/▼/≈>". The verdict label comes from mapping
   * the channel average through `avgToLabel`; the ▲/▼/≈ marker is still computed
   * from the underlying numbers (this video's value vs the channel average).
   */
  const renderCue = (
    label: string,
    avg: number,
    thisValue: number | null,
    avgToLabel: (n: number) => string,
  ): HTMLElement => {
    const span = document.createElement("span");
    let cue = "";
    if (thisValue !== null) {
      const diff = thisValue - avg;
      cue = diff > 0.05 ? " ▲" : diff < -0.05 ? " ▼" : " ≈";
    }
    span.textContent = `${label}: usually ${avgToLabel(avg)}${cue}`;
    return span;
  };

  if (channelStats && channelStats.count >= 1) {
    const header = document.createElement("span");
    header.textContent = `📊 vs channel (${channelStats.count} ${channelStats.count === 1 ? "video" : "videos"})`;
    dimEls.push(header);

    if (toggles.showAiRecommendation && toggles.trackAiAverage && channelStats.avgAiRating !== null) {
      dimEls.push(renderCue("AI", channelStats.avgAiRating, aiThisVideo, scoreToVerdict));
    }
    if (toggles.includeCommentSentiment && toggles.trackCommunityAverage && channelStats.avgAudienceScore !== null) {
      dimEls.push(renderCue("Community", channelStats.avgAudienceScore, audienceScore ?? null, scoreToVerdict));
    }
  }

  // My-dimension cue holder — populated/updated below and on each rating click.
  const myCueHolder = document.createElement("span");
  const refreshMyCue = (rating: "watch" | "skim" | "skip" | null) => {
    myCueHolder.textContent = "";
    if (
      !toggles.askForMyRating ||
      !toggles.trackMyAverage ||
      !channelStats ||
      channelStats.count < 1 ||
      channelStats.avgUserRating === null
    ) {
      return;
    }
    const thisValue = rating ? USER_RATING_SCALE[rating] : null;
    myCueHolder.replaceChildren(
      renderCue("You", channelStats.avgUserRating, thisValue, userAvgToLabel),
    );
  };
  refreshMyCue(initialUserRating ?? null);
  if (channelStats && channelStats.count >= 1) dimEls.push(myCueHolder);

  channelRow.replaceChildren(...dimEls);
  const showChannelRow = dimEls.length > 1; // more than just the header

  // Track the latest selection so a post-persist cue refresh keeps the marker.
  let selectedUserRating: "watch" | "skim" | "skip" | null = initialUserRating ?? null;

  // After a rating durably persists, pull the recomputed channel averages and
  // refresh the "You" cue so it reflects the new vote (the count + average now
  // include this video). Mutates the captured stats in place so renderCue sees
  // the fresh value.
  const onChannelStatsRefresh = (fresh: ChannelComparison) => {
    if (channelStats) {
      channelStats.avgUserRating = fresh.avgUserRating;
      channelStats.count = fresh.count;
      channelStats.userBreakdown = fresh.userBreakdown;
    }
    refreshMyCue(selectedUserRating);
  };

  // --- user personal rating row (My dimension collect/show gate) ---
  const ratingRow = toggles.askForMyRating
    ? buildUserRatingRow(
        t,
        initialUserRating,
        videoId,
        currentChannelInfo?.name,
        (rating) => { selectedUserRating = rating; refreshMyCue(rating); },
        onChannelStatsRefresh,
      )
    : null;

  panel.append(
    head, body,
    ...(ratingRow ? [ratingRow] : []),
    ...(showChannelRow ? [channelRow] : []),
  );
  return panel;
}

/**
 * Shared Engaged / Skimmed / Skipped rating buttons + persistence click handler,
 * used by BOTH the in-panel rating row and the standalone watch-page rating bar.
 *
 * Returns the buttons row element (the three pills, no label/border wrapper) so
 * each caller can frame it however it likes. The click handler is identical for
 * both surfaces: instant cache write + RATE_VIDEO background round-trip, then a
 * channel-stats refresh callback.
 */
function buildRatingButtonsRow(
  t: ReturnType<typeof theme>,
  initial: "watch" | "skim" | "skip" | undefined,
  videoId: string | null | undefined,
  onRatingChange?: (rating: "watch" | "skim" | "skip" | null) => void,
  onChannelStatsRefresh?: (fresh: ChannelComparison) => void,
): HTMLElement {
  // Display labels come from USER_RATING_LABELS; the enum values stay watch/skim/skip.
  const options: { value: "watch" | "skim" | "skip"; label: string; color: string }[] = [
    { value: "watch", label: `▶ ${USER_RATING_LABELS.watch}`, color: "#16a34a" },
    { value: "skim",  label: `≈ ${USER_RATING_LABELS.skim}`,  color: "#d97706" },
    { value: "skip",  label: `✕ ${USER_RATING_LABELS.skip}`,  color: "#dc2626" },
  ];

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" });

  let selected = initial ?? null;
  const btns: HTMLButtonElement[] = [];

  const applyAll = (active: "watch" | "skim" | "skip" | null) => {
    options.forEach(({ value, color }, i) => {
      const b = btns[i]!;
      b.style.background = active === value ? color : t.border;
      b.style.color = active === value ? "#fff" : t.sub;
      b.style.opacity = "1";
    });
  };

  options.forEach(({ value, label, color }) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title =
      selected === value ? "Click to remove rating" : `Rate as ${USER_RATING_LABELS[value]}`;
    Object.assign(btn.style, {
      fontSize: "13px", fontWeight: "700", letterSpacing: "0.03em",
      padding: "0 12px", borderRadius: "999px",
      border: "none", cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
      transition: "background 0.12s, color 0.12s",
      background: selected === value ? color : t.border,
      color: selected === value ? "#fff" : t.sub,
      ...pillGeom,
    });
    btn.addEventListener("mouseenter", () => {
      if (selected === value) {
        // Already selected: hovering signals "click again to remove" — darken
        // the filled pill so the cue is clear even though it stays its color.
        btn.style.background = darken(color);
        btn.style.color = "#fff";
        btn.style.opacity = "1";
      } else {
        btn.style.background = color;
        btn.style.color = "#fff";
        btn.style.opacity = "0.75";
      }
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.opacity = "1";
      btn.style.background = selected === value ? color : t.border;
      btn.style.color = selected === value ? "#fff" : t.sub;
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Clicking the already-selected pill toggles the rating off (deselect).
      const clearing = selected === value;
      selected = clearing ? null : value;
      applyAll(selected);
      // Keep titles in sync with the new selection state.
      options.forEach(({ value: v }, i) => {
        btns[i]!.title =
          selected === v ? "Click to remove rating" : `Rate as ${USER_RATING_LABELS[v]}`;
      });
      const vid = videoId ?? currentVideoId();
      // Show the new selection (or its removal) in the cue immediately
      // (snappy); the channel average refresh happens after the rating durably
      // persists below.
      onRatingChange?.(selected);
      if (vid) {
        // Instant local cache write so a re-serve from cache reflects the
        // rating (or its removal) without waiting on the round-trip.
        void chrome.storage.local.get("tldwSummaryCache").then((r) => {
          type SummaryCache = Record<string, { tldw: unknown; cachedAt: string; userRating?: string }>;
          const cache = (r["tldwSummaryCache"] as SummaryCache) ?? {};
          if (cache[vid]) {
            if (clearing) delete cache[vid]!.userRating;
            else cache[vid]!.userRating = value;
            void chrome.storage.local.set({ tldwSummaryCache: cache });
          }
        });
        // Durably persist the rating (or its removal) via the background: it
        // patches the existing history entry, or creates a lightweight
        // rating-only one if none exists (so the channel always shows up in the
        // Channels view). A null rating clears the entry's rating instead. Once
        // it resolves, re-fetch the channel average so the cue reflects the vote.
        void chrome.runtime
          .sendMessage({
            type: "RATE_VIDEO",
            videoId: vid,
            rating: clearing ? null : value,
            video: {
              url: currentWatchUrl(),
              title: currentVideoTitle(),
              channel: currentChannelInfo?.name,
              avatarUrl: currentChannelInfo?.avatarUrl,
            },
          })
          .then(() => computeChannelComparison(currentChannelInfo?.name))
          .then((fresh) => { if (fresh) onChannelStatsRefresh?.(fresh); })
          .catch(() => { /* best effort */ });
      }
    });
    row.append(btn);
    btns.push(btn);
  });

  return row;
}

/** Engaged / Skimmed / Skipped personal rating row shown below the summary text. */
function buildUserRatingRow(
  t: ReturnType<typeof theme>,
  initial: "watch" | "skim" | "skip" | undefined,
  videoId: string | null | undefined,
  channelName?: string,
  onRatingChange?: (rating: "watch" | "skim" | "skip" | null) => void,
  onChannelStatsRefresh?: (fresh: ChannelComparison) => void,
): HTMLElement {
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    borderTop: `1px solid ${t.border}`, marginTop: "8px", paddingTop: "7px",
  });

  // Rating buttons row, prefixed with a "Your rating:" label.
  const row = buildRatingButtonsRow(t, initial, videoId, onRatingChange, onChannelStatsRefresh);
  const youLabel = document.createElement("span");
  youLabel.textContent = "Your rating:";
  Object.assign(youLabel.style, { fontSize: "13px", color: t.sub, flexShrink: "0" });
  row.prepend(youLabel);

  // channelName retained for signature parity with callers; the per-channel cue
  // is now rendered in the panel's channel-comparison row.
  void channelName;

  wrapper.append(row);

  // API usage indicator (loaded async)
  const apiUsageEl = document.createElement("div");
  Object.assign(apiUsageEl.style, { fontSize: "13px", color: t.sub, marginTop: "5px", textAlign: "right" });
  void chrome.storage.local.get("geminiUsage").then((r) => {
    const usage = r["geminiUsage"] as { todayCalls?: number } | undefined;
    const todayCalls = usage?.todayCalls ?? 0;
    if (todayCalls > 0) {
      apiUsageEl.textContent = `API: ${todayCalls} calls today`;
    }
  });
  wrapper.append(apiUsageEl);

  return wrapper;
}

// --- standalone personal-rating bar (shown when no summary panel exists) -----

const TLDW_RATING_BAR_ID = "tldw-rating-bar";
let ratingBar: HTMLElement | null = null;

function removeStandaloneRatingBar(): void {
  ratingBar?.remove();
  ratingBar = null;
  document.getElementById(TLDW_RATING_BAR_ID)?.remove();
}

/**
 * Read this video's prior personal rating: prefer the summary cache (instant,
 * what the in-panel row also reads from), fall back to the durable history.
 */
async function loadPriorUserRating(
  videoId: string,
): Promise<"watch" | "skim" | "skip" | undefined> {
  const r = await chrome.storage.local.get(["tldwSummaryCache", "history"]);
  const cache = r["tldwSummaryCache"] as
    | Record<string, { userRating?: "watch" | "skim" | "skip" }>
    | undefined;
  const cached = cache?.[videoId]?.userRating;
  if (cached) return cached;
  type HistEntry = { videoUrl?: string; userRating?: "watch" | "skim" | "skip" };
  const history = (r["history"] as HistEntry[]) ?? [];
  const match = history.find(
    (e) => e.userRating && e.videoUrl && new URLSearchParams(new URL(e.videoUrl).search).get("v") === videoId,
  );
  return match?.userRating;
}

/**
 * Inject the COMPACT standalone rating bar on the current watch page. Gated on
 * the `askForMyRating` setting and mutually exclusive with the Direct-API
 * summary panel: when a rating-owning summary panel (or its loading skeleton)
 * is present, the rating lives in that panel's row, so this is a no-op (and any
 * stale bar is removed). It coexists with the idle "Get Summary" placeholder.
 * Shows the user's prior vote highlighted plus the "You: usually <verdict> · n
 * rated" channel cue.
 */
async function maybeShowStandaloneRatingBar(): Promise<void> {
  // Mutual exclusion: the summary (and its in-flight loading skeleton) owns the
  // rating, so the bar must stay hidden then. The idle placeholder has no rating
  // row, so the bar shows alongside it.
  const ownedByPanel = () => summaryPanelKind === "summary" || summaryPanelKind === "loading";
  if (ownedByPanel()) { removeStandaloneRatingBar(); return; }

  const vid = currentVideoId();
  if (!vid) { removeStandaloneRatingBar(); return; }

  // No TL;DW rating UI on an in-progress live stream (nothing to rate yet); a
  // finished/recorded one (transcript present) behaves like a normal video.
  if (isUnsummarizableLive()) { removeStandaloneRatingBar(); return; }

  const toggles = await loadRatingToggles();
  if (!toggles.askForMyRating) { removeStandaloneRatingBar(); return; }

  // Re-check exclusion after the async read — a summary may have arrived.
  if (ownedByPanel()) { removeStandaloneRatingBar(); return; }

  const host = panelHost();
  if (!host) return;

  const [prior, channelStats] = await Promise.all([
    loadPriorUserRating(vid),
    computeChannelComparison(currentChannelInfo?.name),
  ]);

  // Final exclusion + staleness checks after all async work.
  if (ownedByPanel()) { removeStandaloneRatingBar(); return; }
  if (currentVideoId() !== vid) return;
  const h = panelHost();
  if (!h) return;

  const t = theme();

  const bar = document.createElement("div");
  bar.id = TLDW_RATING_BAR_ID;
  Object.assign(bar.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "8px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif", color: t.text,
    display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
  });

  const label = document.createElement("span");
  label.textContent = "Your rating:";
  Object.assign(label.style, { fontSize: "13px", color: t.sub, flexShrink: "0", fontWeight: "700" });

  // The "You: usually <verdict> · n rated" channel cue, refreshed after a vote.
  const cue = document.createElement("span");
  Object.assign(cue.style, { fontSize: "12px", color: t.sub, flexShrink: "0" });
  const refreshCue = () => {
    cue.textContent = "";
    if (
      toggles.trackMyAverage &&
      channelStats &&
      channelStats.count >= 1 &&
      channelStats.avgUserRating !== null
    ) {
      cue.textContent = `You: usually ${userAvgToLabel(channelStats.avgUserRating)} · ${channelStats.count} rated`;
    }
  };
  refreshCue();

  const onChannelStatsRefresh = (fresh: ChannelComparison) => {
    if (channelStats) {
      channelStats.avgUserRating = fresh.avgUserRating;
      channelStats.count = fresh.count;
      channelStats.userBreakdown = fresh.userBreakdown;
    }
    refreshCue();
  };

  const buttons = buildRatingButtonsRow(t, prior, vid, undefined, onChannelStatsRefresh);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  bar.append(label, buttons, spacer, cue);

  removeStandaloneRatingBar();
  ratingBar = bar;
  h.prepend(bar);
  log("standalone rating bar injected");
}

function showSummaryPanel(
  tldw: TldwSummary,
  channelStats?: ChannelComparison,
  userRating?: "watch" | "skim" | "skip",
  videoId?: string | null,
  audienceScore?: number,
): void {
  const host = panelHost();
  if (!host) return;

  const vid = videoId ?? currentVideoId();
  void loadRatingToggles().then((toggles) => {
    // The host may have changed between the async read and now; re-resolve.
    const h = panelHost();
    if (!h) return;
    removeSummaryPanel();
    // Summary panel owns the rating now — drop the standalone bar.
    removeStandaloneRatingBar();
    const panel = buildSummaryPanel(tldw, channelStats, userRating, vid, toggles, audienceScore);
    summaryPanel = panel;
    summaryPanelKind = "summary";
    h.prepend(summaryPanel);
    log("summary panel injected");
    refreshSponsorPanel();
  });
}

/** Full-page overlay confirmation before permanently skipping a channel. */
function showSkipOverlay(
  channelName: string,
  info: ChannelInfo | null,
  mode: "summary" | "comments",
  onCancel: () => void,
): void {
  document.getElementById("tldw-skip-overlay")?.remove();
  const t = theme();

  const overlay = document.createElement("div");
  overlay.id = "tldw-skip-overlay";
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
    padding: "28px 32px", maxWidth: "420px", width: "90%",
    boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
    display: "flex", flexDirection: "column", gap: "16px",
  });

  // Header: TL;DW icon + "Skip channel"
  const hd = document.createElement("div");
  Object.assign(hd.style, { display: "flex", alignItems: "center", gap: "12px" });
  const hdIcon = document.createElement("img");
  hdIcon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(hdIcon.style, { width: "48px", height: "48px", borderRadius: "8px", flexShrink: "0" });
  const hdTitle = document.createElement("span");
  hdTitle.textContent = "Skip channel";
  Object.assign(hdTitle.style, { fontWeight: "700", fontSize: "18px", color: t.text });
  hd.append(hdIcon, hdTitle);

  // Body: [avatar] ChannelName — description flows inline
  const desc = document.createElement("div");
  Object.assign(desc.style, { display: "flex", alignItems: "flex-start", gap: "10px" });

  if (info?.avatarUrl) {
    const avImg = document.createElement("img");
    avImg.src = info.avatarUrl;
    Object.assign(avImg.style, { width: "40px", height: "40px", borderRadius: "50%", flexShrink: "0", marginTop: "2px" });
    desc.append(avImg);
  }

  const textBlock = document.createElement("div");
  Object.assign(textBlock.style, { fontSize: "15px", color: t.sub, lineHeight: "1.65" });

  const nameLine = document.createElement("div");
  Object.assign(nameLine.style, { marginBottom: "8px" });
  const chNameEl = document.createElement("strong");
  chNameEl.textContent = channelName;
  Object.assign(chNameEl.style, { fontSize: "16px", color: t.text });
  const cacheNote = document.createElement("span");
  cacheNote.textContent = " Cached summaries will also be deleted.";
  nameLine.append(
    chNameEl,
    document.createTextNode(" — Choose what to skip for this channel."),
    cacheNote,
  );

  const reopenNote = document.createElement("div");
  const settingsBold = document.createElement("strong");
  settingsBold.textContent = "TL;DW Settings → Channels";
  reopenNote.append(
    document.createTextNode("To re-enable, go to "),
    settingsBold,
    document.createTextNode(" and click Unblock next to this channel."),
  );

  textBlock.append(nameLine, reopenNote);
  desc.append(textBlock);

  // Checkboxes: one for each panel type
  const mkCheckRow = (labelText: string, checked: boolean) => {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "15px", color: t.text });
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = checked;
    Object.assign(cb.style, { width: "18px", height: "18px", cursor: "pointer", accentColor: "#dc2626", flexShrink: "0" });
    const lbl = document.createElement("span"); lbl.textContent = labelText;
    wrap.append(cb, lbl);
    return { wrap, cb };
  };
  const { wrap: summaryWrap, cb: summaryCb } = mkCheckRow("Skip AI summaries for this channel", mode === "summary");
  const { wrap: commentsWrap, cb: commentsCb } = mkCheckRow("Skip comment analysis for this channel", mode === "comments");
  const checks = document.createElement("div");
  Object.assign(checks.style, { display: "flex", flexDirection: "column", gap: "10px" });
  checks.append(summaryWrap, commentsWrap);

  // Buttons: Cancel on left, Confirm on right
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "10px", justifyContent: "space-between" });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  Object.assign(cancelBtn.style, {
    padding: "10px 24px", borderRadius: "999px",
    border: `1px solid ${t.border}`, background: "transparent",
    color: t.text, cursor: "pointer", fontSize: "15px", fontWeight: "600",
  });
  cancelBtn.addEventListener("click", () => { overlay.remove(); onCancel(); });

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Yes, skip this channel";
  Object.assign(confirmBtn.style, {
    padding: "10px 24px", borderRadius: "999px",
    border: "none", background: "#dc2626",
    color: "#fff", cursor: "pointer", fontSize: "15px", fontWeight: "600",
  });
  const syncOverlay = () => {
    const any = summaryCb.checked || commentsCb.checked;
    confirmBtn.disabled = !any;
    confirmBtn.style.opacity = any ? "1" : "0.45";
    confirmBtn.style.cursor = any ? "pointer" : "default";
    cacheNote.style.display = summaryCb.checked ? "" : "none";
  };
  summaryCb.addEventListener("change", syncOverlay);
  commentsCb.addEventListener("change", syncOverlay);
  syncOverlay();

  confirmBtn.addEventListener("click", () => {
    overlay.remove();
    const finalInfo = info ?? getChannelInfo();
    if (summaryCb.checked) {
      if (finalInfo) void addBlockedChannelEntry(finalInfo).then(() => { removeSummaryPanel(); });
      else removeSummaryPanel();
    }
    if (commentsCb.checked) {
      if (finalInfo) void addBlockedCommentsChannelEntry(finalInfo).then(() => { removeCommentsPanel(); });
      else removeCommentsPanel();
    }
  });

  row.append(cancelBtn, confirmBtn);
  modal.append(hd, desc, checks, row);
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); onCancel(); } });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { overlay.remove(); onCancel(); document.removeEventListener("keydown", esc); }
  });
  document.body.appendChild(overlay);
}

/** Confirmation overlay shown before enabling auto-run for a channel. */
function showAutoRunConfirmOverlay(
  info: ChannelInfo,
  field: "summary" | "comments",
  onConfirm: () => void,
  onCancel: () => void,
): void {
  document.getElementById("tldw-autorun-overlay")?.remove();
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

  const what = field === "summary" ? "AI summary" : "comment analysis";
  const nameLine = document.createElement("div");
  Object.assign(nameLine.style, { marginBottom: "8px" });
  const chNameEl = document.createElement("strong");
  chNameEl.textContent = info.name;
  Object.assign(chNameEl.style, { fontSize: "15px", color: t.text });
  nameLine.append(
    chNameEl,
    document.createTextNode(` — Every new video from this channel will automatically get an ${what}.`),
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
  cancelBtn.addEventListener("click", () => { overlay.remove(); onCancel(); });

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Enable auto-run";
  Object.assign(confirmBtn.style, {
    padding: "10px 24px", borderRadius: "999px",
    border: "none", background: "#1a73e8",
    color: "#fff", cursor: "pointer", fontSize: "15px", fontWeight: "600",
  });
  confirmBtn.addEventListener("click", () => { overlay.remove(); onConfirm(); });

  row.append(cancelBtn, confirmBtn);
  modal.append(hd, body, row);
  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); onCancel(); } });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { overlay.remove(); onCancel(); document.removeEventListener("keydown", esc); }
  });
  document.body.appendChild(overlay);
}

/** Show the idle panel — TL;DW icon + title + Get Summary + Never all in one header row. */
function showIdlePanel(onGetSummary: () => void): void {
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

  const capturedChannelInfo = currentChannelInfo;

  const summaryBtn = document.createElement("button");
  summaryBtn.textContent = "TL;DW";
  Object.assign(summaryBtn.style, {
    fontSize: "13px", fontWeight: "700", letterSpacing: "0.03em",
    padding: "0 16px", borderRadius: "999px",
    background: "#1a73e8", color: "#fff",
    border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: "0",
    ...pillGeom,
  });
  summaryBtn.title = "Get TL;DW summary of this video";
  summaryBtn.addEventListener("mouseenter", () => { summaryBtn.style.background = "#1557b0"; });
  summaryBtn.addEventListener("mouseleave", () => { summaryBtn.style.background = "#1a73e8"; });
  summaryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeSummaryPanel();
    onGetSummary();
  });

  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip channel";
  Object.assign(skipBtn.style, {
    fontSize: "12px", fontWeight: "600",
    padding: "0 14px", borderRadius: "999px",
    background: "transparent", color: t.sub,
    border: `1px solid ${t.border}`, cursor: "pointer", whiteSpace: "nowrap", flexShrink: "0",
    ...pillGeom,
  });
  skipBtn.title = "Skip TL;DW for this channel";
  skipBtn.addEventListener("mouseenter", () => { skipBtn.style.borderColor = "#dc2626"; skipBtn.style.color = "#dc2626"; });
  skipBtn.addEventListener("mouseleave", () => { skipBtn.style.borderColor = t.border; skipBtn.style.color = t.sub; });
  skipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const info = capturedChannelInfo ?? getChannelInfo();
    const channelName = info?.name ?? "this channel";
    showSkipOverlay(channelName, info, "summary", () => { /* panel stays open */ });
  });

  // Build the header with the TL;DW action + Skip channel as inline controls.
  // No left-hand "TL;DW" label here — the TL;DW button itself is the affordance.
  const head = buildPanelHead(t, [summaryBtn, skipBtn], capturedChannelInfo, false, false, false);
  panel.append(head);

  // Idle panel is shown alongside the standalone rating bar: the bar lets the
  // user rate without summarizing, while this offers "Get Summary". They are
  // separate affordances. The bar itself is injected by maybeStartDirectApiRun's
  // caller (onNavigate) once this resolves, so nothing to do here.
  summaryPanel = panel;
  summaryPanelKind = "idle";
  host.prepend(panel);
  log("idle panel shown");
  refreshSponsorPanel();
}

// --- comments panel (injected into ytd-comments-header-renderer) ----------

function showCommentsSentimentResult(sentiment: string, audienceScore?: number): void {
  const target = commentsCardTarget();
  removeCommentsPanel();
  if (!target) return;

  const t = theme();
  const panel = document.createElement("div");
  panel.id = TLDW_COMMENTS_PANEL_ID;
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginBottom: "12px",
    font: "14px/1.4 Roboto, system-ui, sans-serif", color: t.text,
  });

  // Header row: icon + title + score + close
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "7px", marginBottom: "8px" });

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(icon.style, { width: "28px", height: "28px", borderRadius: "6px", flexShrink: "0" });

  const title = document.createElement("span");
  title.textContent = "Comment Analysis";
  Object.assign(title.style, { fontWeight: "700", fontSize: "15px", color: t.text, flexShrink: "0" });

  const spacer = document.createElement("div"); spacer.style.flex = "1";

  const closeBtn = document.createElement("button");
  Object.assign(closeBtn.style, {
    background: "transparent", border: "none", color: t.sub, cursor: "pointer",
    fontSize: "14px", lineHeight: "1", padding: "4px 6px", borderRadius: "6px", flexShrink: "0",
  });
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("mouseenter", () => (closeBtn.style.background = t.hover));
  closeBtn.addEventListener("mouseleave", () => (closeBtn.style.background = "transparent"));
  closeBtn.addEventListener("click", removeCommentsPanel);

  const autoToggle = currentChannelInfo
    ? buildAutoToggle(currentChannelInfo, "comments", currentAutoRunComments, t)
    : null;

  const skipCommentsBtn = currentChannelInfo ? (() => {
    const info = currentChannelInfo;
    const btn = document.createElement("button");
    btn.textContent = "⊘ Skip channel";
    Object.assign(btn.style, {
      fontSize: "13px", fontWeight: "700", padding: "0 12px", borderRadius: "999px",
      border: "none", cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
      background: t.border, color: t.sub, transition: "background 0.15s, color 0.15s",
      ...pillGeom,
    });
    btn.addEventListener("mouseenter", () => { btn.style.background = "#dc2626"; btn.style.color = "#fff"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = t.border; btn.style.color = t.sub; });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showSkipOverlay(info.name, info, "comments", () => { /* stay */ });
    });
    return btn;
  })() : null;

  closeBtn.style.marginLeft = "12px";
  const rightItems = [...(autoToggle ? [autoToggle] : []), ...(skipCommentsBtn ? [skipCommentsBtn] : [])];
  if (audienceScore !== undefined) {
    const verdict = scoreToVerdict(audienceScore);
    const scorePill = document.createElement("span");
    scorePill.textContent = verdict;
    Object.assign(scorePill.style, {
      fontSize: "11px", fontWeight: "700", padding: "0 9px",
      borderRadius: "999px", background: verdictColor(verdict), color: "#fff", whiteSpace: "nowrap",
      ...pillGeom,
    });
    head.append(icon, title, scorePill, spacer, ...rightItems, closeBtn);
  } else {
    head.append(icon, title, spacer, ...rightItems, closeBtn);
  }

  const text = document.createElement("div");
  text.textContent = sentiment;
  Object.assign(text.style, { fontSize: "13px", color: t.text, lineHeight: "1.5" });

  panel.append(head, text);
  target.container.insertBefore(panel, target.referenceNode);
  pendingCommentSentiment = null;
  log("comment sentiment shown in comments panel");
}

/** Fill the comments panel with sentiment. Falls back to storing pending if comments section not yet in DOM. */
function fillCommunitySection(sentiment: string, audienceScore?: number): void {
  if (commentsHeaderHost()) {
    showCommentsSentimentResult(sentiment, audienceScore);
  } else {
    pendingCommentSentiment = { sentiment, audienceScore };
    log("comment sentiment stored as pending — comments section not yet in DOM");
  }
}

function showCommentsIdlePanel(onGetComments: () => void): void {
  const target = commentsCardTarget();
  if (!target) return;
  removeCommentsPanel();

  const t = theme();
  const capturedChannelInfo = currentChannelInfo;

  const panel = document.createElement("div");
  panel.id = TLDW_COMMENTS_PANEL_ID;
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginBottom: "12px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
  });

  const getBtn = document.createElement("button");
  getBtn.textContent = "Get Comment Analysis";
  Object.assign(getBtn.style, {
    fontSize: "13px", fontWeight: "600", padding: "0 16px", borderRadius: "999px",
    background: "#0d9488", color: "#fff", border: "none", cursor: "pointer",
    whiteSpace: "nowrap", flexShrink: "0",
    ...pillGeom,
  });
  getBtn.title = "Analyze viewer comments for this video";
  getBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    getBtn.textContent = "Analyzing…";
    getBtn.disabled = true;
    onGetComments();
  });

  const skipCommentsBtn = document.createElement("button");
  skipCommentsBtn.textContent = "Skip channel";
  Object.assign(skipCommentsBtn.style, {
    fontSize: "12px", fontWeight: "600", padding: "0 14px", borderRadius: "999px",
    background: "transparent", color: t.sub, border: `1px solid ${t.border}`,
    cursor: "pointer", whiteSpace: "nowrap", flexShrink: "0",
    ...pillGeom,
  });
  skipCommentsBtn.title = "Skip TL;DW comment analysis for this channel";
  skipCommentsBtn.addEventListener("mouseenter", () => { skipCommentsBtn.style.borderColor = "#dc2626"; skipCommentsBtn.style.color = "#dc2626"; });
  skipCommentsBtn.addEventListener("mouseleave", () => { skipCommentsBtn.style.borderColor = t.border; skipCommentsBtn.style.color = t.sub; });
  skipCommentsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const info = capturedChannelInfo ?? getChannelInfo();
    const channelName = info?.name ?? "this channel";
    showSkipOverlay(channelName, info, "comments", () => { /* panel stays open */ });
  });

  // Header row: icon + title + action buttons + close
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "7px" });

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(icon.style, { width: "28px", height: "28px", borderRadius: "6px", flexShrink: "0" });

  const titleEl = document.createElement("span");
  titleEl.textContent = "TL;DW";
  Object.assign(titleEl.style, { fontWeight: "700", fontSize: "15px", color: t.text, flexShrink: "0" });

  const spacer = document.createElement("div"); spacer.style.flex = "1";

  const closeBtn = document.createElement("button");
  Object.assign(closeBtn.style, {
    background: "transparent", border: "none", color: t.sub, cursor: "pointer",
    fontSize: "14px", lineHeight: "1", padding: "4px 6px", borderRadius: "6px", flexShrink: "0",
  });
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("mouseenter", () => (closeBtn.style.background = t.hover));
  closeBtn.addEventListener("mouseleave", () => (closeBtn.style.background = "transparent"));
  closeBtn.addEventListener("click", removeCommentsPanel);

  closeBtn.style.marginLeft = "12px";
  head.append(icon, titleEl, getBtn, skipCommentsBtn, spacer, closeBtn);
  panel.append(head);

  target.container.insertBefore(panel, target.referenceNode);
  log("comments idle panel shown");
}

async function maybeStartCommentsInjection(): Promise<void> {
  const r = await chrome.storage.local.get(["settings", AUTO_RUN_CHANNELS_KEY, BLOCKED_COMMENTS_KEY]);
  const s = r["settings"] as Record<string, unknown> | undefined;
  if (!(s?.useDirectApi as boolean) || !(s?.geminiApiKey as string)) return;

  // If we have a pending cached sentiment, show it immediately.
  if (pendingCommentSentiment) {
    showCommentsSentimentResult(pendingCommentSentiment.sentiment, pendingCommentSentiment.audienceScore);
    return;
  }

  // Check if comments are blocked for this channel.
  if (currentChannelInfo) {
    const blocked = (r[BLOCKED_COMMENTS_KEY] as BlockedChannelEntry[]) ?? [];
    if (blocked.some((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)) {
      log("comment analysis blocked for channel:", currentChannelInfo.name);
      return;
    }
  }

  const autoRunChannels = (r[AUTO_RUN_CHANNELS_KEY] as AutoRunChannelEntry[]) ?? [];
  const channelEntry = currentChannelInfo
    ? autoRunChannels.find((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)
    : undefined;
  const shouldAutoRun = channelEntry?.autoRunComments ?? false;
  currentAutoRunComments = shouldAutoRun;

  const fireComments = () => {
    try { void chrome.runtime.sendMessage({ type: "ASK_COMMENTS" }); } catch { /* best effort */ }
  };

  if (shouldAutoRun) {
    // Show a loading shimmer card and kick off the call.
    const target = commentsCardTarget();
    if (target) {
      removeCommentsPanel();
      const t = theme();
      ensureShimmerStyle();
      const panel = document.createElement("div");
      panel.id = TLDW_COMMENTS_PANEL_ID;
      Object.assign(panel.style, {
        background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
        padding: "10px 14px", marginBottom: "12px",
        font: "13px/1.4 Roboto, system-ui, sans-serif",
        fontSize: "13px", color: t.sub,
        animation: "tldw-shimmer 1.4s infinite",
      });
      panel.textContent = "💬 Analyzing comments…";
      target.container.insertBefore(panel, target.referenceNode);
    }
    fireComments();
  } else {
    showCommentsIdlePanel(fireComments);
  }
}

function watchForCommentsSection(): void {
  if (commentsObserver) { commentsObserver.disconnect(); commentsObserver = null; }
  if (commentsHeaderHost()) {
    void maybeStartCommentsInjection();
    return;
  }
  commentsObserver = new MutationObserver(() => {
    if (commentsHeaderHost()) {
      commentsObserver?.disconnect();
      commentsObserver = null;
      void maybeStartCommentsInjection();
    }
  });
  commentsObserver.observe(document.body, { childList: true, subtree: true });
}

// --- auto TL;DW ----------------------------------------------------------

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const autoRunVideoIds = new Set<string>();

/**
 * Direct API path: fires on navigation.
 * - Reads the channel auto-run list and cache from storage.
 * - If there's a cached result: show it immediately.
 * - If the channel is on the auto-run list: show the loading skeleton and fire
 *   the Gemini API call automatically.
 * - Otherwise: show an idle panel with a "Get Summary" button and a per-channel
 *   auto-run toggle so the user can opt in for future visits.
 */
async function maybeStartDirectApiRun(): Promise<void> {
  const vid = currentVideoId();
  if (!vid) return;

  // In-progress live streams have no transcript to summarize — don't offer the
  // summary UI. A finished/recorded live stream has a transcript, so it's fine.
  if (isUnsummarizableLive()) { removeSummaryPanel(); return; }

  // Set currentChannelInfo early so comments injection can use it even when we return early.
  currentChannelInfo = getChannelInfo();

  const r = await chrome.storage.local.get(["settings", "tldwSummaryCache", AUTO_RUN_CHANNELS_KEY, BLOCKED_CHANNELS_KEY]);
  // The on-page widget shows whether or not Direct API is configured. With no
  // key the TL;DW button and auto-summarize run the tab-scrape flow (open the
  // destination, read its answer back, inject it here) instead of a headless
  // Gemini call — "show UI here" is decoupled from "which backend is set".

  // YouTube may not have rendered channel info yet at t=1s on a fresh page load; retry briefly.
  if (!currentChannelInfo) {
    for (let i = 0; i < 8; i++) {
      await sleep(250);
      currentChannelInfo = getChannelInfo();
      if (currentChannelInfo) break;
    }
  }

  // If the user has blocked this channel from summary, skip injection entirely.
  if (currentChannelInfo) {
    const blocked = (r[BLOCKED_CHANNELS_KEY] as BlockedChannelEntry[]) ?? [];
    if (blocked.some((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)) {
      log("channel blocked from summary, skipping panel injection:", currentChannelInfo.name);
      return;
    }
  }

  const autoRunChannels = await readAutoRunChannels();
  const channelEntry = currentChannelInfo
    ? autoRunChannels.find((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)
    : undefined;

  currentAutoRunSummary = channelEntry?.autoRunSummary ?? false;

  type CacheEntry = { tldw: TldwSummary; cachedAt: string; commentSentiment?: string; audienceScore?: number; userRating?: "watch" | "skim" | "skip"; channelName?: string };

  // Serve a cached result if fresh, then optionally load pending comment sentiment.
  const serveCached = (entry: CacheEntry) => {
    void computeChannelComparison(currentChannelInfo?.name).then((channelStats) => {
      showSummaryPanel(
        { ...entry.tldw, source: "cached" },
        channelStats,
        entry.userRating,
        vid,
        entry.audienceScore,
      );
    });
    if (entry.commentSentiment) {
      pendingCommentSentiment = { sentiment: entry.commentSentiment, audienceScore: entry.audienceScore };
    }
    log("served from cache");
  };

  // Helper: check cache first (re-reads storage for freshness), then fall back to API.
  const startApiCall = async () => {
    const freshR = await chrome.storage.local.get("tldwSummaryCache");
    const freshCache = (freshR["tldwSummaryCache"] as Record<string, CacheEntry> | undefined)?.[vid];
    if (freshCache && Date.now() - new Date(freshCache.cachedAt).getTime() < CACHE_TTL_MS) {
      serveCached(freshCache);
      return;
    }
    showLoadingPanel();
    void getTranscript();
    log("summary run started");
    try {
      await chrome.runtime.sendMessage({ type: "ASK" });
    } catch { /* best effort */ }
  };
  // Expose for the loading-timeout retry panel.
  currentSummarizeAction = startApiCall;

  const cache = r["tldwSummaryCache"] as Record<string, CacheEntry> | undefined;
  const cached = cache?.[vid];
  const cacheHit = !!(cached && Date.now() - new Date(cached.cachedAt).getTime() < CACHE_TTL_MS);

  // If we already have a fresh cached result, show it directly — there's no
  // reason to drop the user back to the idle "Get Summary" view for a video
  // we've already summarized. Applies whether or not auto-run is enabled.
  if (cacheHit) {
    serveCached(cached!);
    return;
  }

  // Auto-run summary: fire immediately. In tab mode this auto-opens the
  // destination tab (the user opted into auto-summarize for this channel);
  // headless mode runs the Gemini call with no tab.
  if (currentAutoRunSummary) {
    await startApiCall();
    return;
  }

  // Show idle panel with the manual "TL;DW" + "Skip channel" buttons. Clicking
  // runs the configured backend (headless Gemini, or the tab-scrape flow).
  showIdlePanel(() => { void startApiCall(); });
}

/**
 * Threshold path: waits 2500ms so the video element has its duration, then
 * runs for videos over the configured length (opens a tab — not headless).
 */
async function autoRunIfLong(): Promise<void> {
  const vid = currentVideoId();
  if (!vid || autoRunVideoIds.has(vid) || summaryPanel) return;

  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as Record<string, unknown> | undefined;
  const threshold = (s?.autoTldwMinutes as number) ?? 0;
  if (!threshold) return;

  const { durationSeconds } = getVideoMeta();
  if (!durationSeconds || durationSeconds / 60 < threshold) return;

  autoRunVideoIds.add(vid);
  log("auto-running TL;DW for", Math.round(durationSeconds / 60), "min video");
  try {
    await chrome.runtime.sendMessage({ type: "ASK" });
  } catch {
    /* best effort */
  }
}

// yt-navigate-finish doesn't fire for all YouTube SPA navigation types.
// Three-layer strategy: immediate (page load / refresh), event-based (when
// YouTube fires its own event), and 500ms polling (everything else).
let lastHandledUrl = "";

function onNavigate(): void {
  // Normalize to video ID so URL decorations added by YouTube (?t=123, &pp=…)
  // don't trigger a spurious re-run that wipes the panels.
  const vid = currentVideoId();
  const url = vid ? `v=${vid}` : (location.pathname + location.search);
  if (url === lastHandledUrl) return;
  lastHandledUrl = url;
  removeSummaryPanel();
  removeStandaloneRatingBar();
  removeCommentsPanel();
  if (commentsObserver) { commentsObserver.disconnect(); commentsObserver = null; }
  pendingCommentSentiment = null;
  activeTranscriptFetch = null;
  currentChannelInfo = null;
  currentAutoRunSummary = false;
  currentAutoRunComments = false;
  // After the Direct-API flow settles (cached summary / idle panel / Basic-mode
  // early-return), inject the standalone rating bar. It is gated on the
  // askForMyRating setting and no-ops when a rating-owning summary panel is up,
  // so this single call covers Basic mode, idle, and post-summary states.
  void maybeStartDirectApiRun()
    .then(() => { watchForCommentsSection(); })
    .finally(() => { void maybeShowStandaloneRatingBar(); });
  setTimeout(() => { void autoRunIfLong(); }, 2500);
}

// On page refresh / initial load, delay 1 s so YouTube's Polymer components
// finish their initial render before we inject. Firing immediately (at
// document_idle) means YouTube's own DOM update wipes the panel out before
// the user sees it. yt-navigate-finish and the 500ms interval handle
// subsequent SPA navigations without any delay.
setTimeout(onNavigate, 1000);
window.addEventListener("yt-navigate-finish", onNavigate);
setInterval(onNavigate, 500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === "GET_TRANSCRIPT") {
    log("transcript requested");
    void getTranscript().then((transcript) => sendResponse({ transcript }));
    return true;
  }
  if (type === "GET_COMMENTS") {
    log("comments requested");
    void getTopComments().then((comments) => sendResponse({ comments }));
    return true;
  }
  if (type === "PAUSE_VIDEO") {
    const video = document.querySelector<HTMLVideoElement>(
      "video.html5-main-video, video",
    );
    video?.pause();
    sendResponse({ paused: !!video });
    return false;
  }
  if (type === "GET_VIDEO_META") {
    sendResponse(getVideoMeta());
    return false;
  }
  if (type === "GET_CHANNEL_STATUS") {
    const info = currentChannelInfo ?? getChannelInfo();
    if (!info) {
      sendResponse({ isBlocked: false, isCommentsBlocked: false, channelName: null });
      return false;
    }
    void Promise.all([
      chrome.storage.local.get(BLOCKED_CHANNELS_KEY),
      chrome.storage.local.get(BLOCKED_COMMENTS_KEY),
    ]).then(([r1, r2]) => {
      const blocked = (r1[BLOCKED_CHANNELS_KEY] as BlockedChannelEntry[]) ?? [];
      const blockedComments = (r2[BLOCKED_COMMENTS_KEY] as BlockedChannelEntry[]) ?? [];
      sendResponse({
        isBlocked: blocked.some((c) => c.id === info.id || c.name === info.name),
        isCommentsBlocked: blockedComments.some((c) => c.id === info.id || c.name === info.name),
        channelName: info.name,
      });
    });
    return true; // async response
  }
  if (type === "SET_SUMMARY") {
    const msg = message as { tldw?: TldwSummary; source?: string; channelStats?: ChannelComparison };
    const tldw = msg?.tldw;
    if (tldw?.verdict && tldw.summary) {
      const vid = currentVideoId();
      // Carry any rating the user already cast (e.g. in the standalone bar
      // before summarizing) into the panel's rating row so it shows pre-selected
      // rather than looking like a second, fresh "rate this" prompt.
      if (vid) {
        void loadPriorUserRating(vid).then((prior) =>
          showSummaryPanel({ ...tldw, source: msg.source }, msg.channelStats, prior, vid),
        );
      } else {
        showSummaryPanel({ ...tldw, source: msg.source }, msg.channelStats, undefined, vid);
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  if (type === "SET_COMMENT_SENTIMENT") {
    const msg = message as { sentiment?: string; audienceScore?: number };
    if (msg.sentiment) {
      fillCommunitySection(msg.sentiment, msg.audienceScore);
    } else {
      // No sentiment (comments unavailable or error) — just remove loading shimmer.
      removeCommentsPanel();
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

export {};
