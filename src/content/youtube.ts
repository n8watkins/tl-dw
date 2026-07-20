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
  CHANNEL_TAGS_KEY,
  TAGS_KEY,
  VIDEO_TAGS_KEY,
  pruneCache,
} from "../lib/constants";
import type { SponsorWindowApi, Tag } from "../types";

// --- intercepted transcript cache ----------------------------------------

let captured: string | null = null;
let capturedVideoId: string | null = null;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as
    | { __tldw?: boolean; kind?: string; body?: unknown; videoId?: string }
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
    // Tag with the id the interceptor captured when the request was ISSUED, not
    // the current URL: a late response for the previous video must not be served
    // as the current one's transcript after an SPA navigation.
    capturedVideoId =
      typeof data.videoId === "string" && data.videoId ? data.videoId : currentVideoId();
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

  const startVid = currentVideoId();
  activeTranscriptFetch = (async () => {
    const { openedByUs, expandedByUs } = await openTranscriptPanel();
    // Leave the page as we found it: collapse the panel AND the description if
    // *we* opened/expanded them. A panel/description the user already had open
    // is left untouched. Skip the restore entirely if the user navigated away
    // mid-fetch — otherwise we'd click the NEW video's transcript/description
    // controls, toggling panels the user didn't touch.
    const restore = () => {
      if (currentVideoId() !== startVid) return;
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
function getVideoMeta(): { durationSeconds: number; channel: string; channelId?: string; avatarUrl?: string } {
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
  // The channel id/href so the background can resolve channel tags by id (the key
  // the tag row writes under), not just the display name.
  const channelId = getChannelInfo()?.id;
  return { durationSeconds, channel, channelId, avatarUrl };
}

// --- auto-run channel helpers (direct storage; no lib imports in content script) --

const AUTO_RUN_CHANNELS_KEY = "autoRunChannels";

type AutoRunChannelEntry = {
  id: string; name: string; avatarUrl: string; addedAt: string;
  autoRunSummary: boolean;
};

/**
 * Cache a summary that arrived via SET_SUMMARY (the tab-scrape path). The
 * headless Direct-API path caches in the background worker, but tab-mode results
 * were never persisted — so a page refresh kept re-opening the destination tab.
 * Caching here makes a reload serve from cache instead.
 */
async function cacheScrapedSummary(vid: string, tldw: TldwSummary): Promise<void> {
  const r = await chrome.storage.local.get("tldwSummaryCache");
  const cache = (r["tldwSummaryCache"] as Record<string, { cachedAt: string } & Record<string, unknown>>) ?? {};
  const existing = cache[vid] ?? {};
  cache[vid] = {
    ...existing,
    tldw,
    cachedAt: new Date().toISOString(),
  };
  // Same TTL + count cap the background uses, so the tab-mode path doesn't grow
  // the cache unbounded.
  pruneCache(cache);
  await chrome.storage.local.set({ tldwSummaryCache: cache });
}

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

type TldwSummary = { summary: string; details?: string; source?: string };

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
function showSummaryErrorPanel(reason?: string): void {
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
  msg.textContent = reason
    ? `Couldn't get the summary: ${reason}`
    : "Couldn't get the summary back in time. If you're using the tab flow (no API key), " +
      "the destination tab may still be working or may need a sign-in — check it, then retry.";
  Object.assign(msg.style, { fontSize: "13px", lineHeight: "1.5", color: t.sub });

  panel.append(head, msg);
  summaryPanel = panel;
  summaryPanelKind = "idle";
  host.prepend(panel);
  log("summary error panel shown (loading timed out)");
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
  const { promote = false, forceRun = false } = opts;
  const startEpoch = navEpoch;
  // Arm (Regenerate) or clear (Clear cache) the promote offer. The rebuilt
  // summary's tags row recomputes the actual video-only set and drops the flag if
  // none remain, so we only need to flag the video here — no extra storage read.
  pendingTagPromptVid = promote && vid ? vid : null;

  // Drop this video's cache entry. Wrap in try/catch so a storage hiccup can't
  // skip the re-run below — the old clearBtn used .finally to re-run regardless.
  try {
    const r = await chrome.storage.local.get("tldwSummaryCache");
    const cache = (r["tldwSummaryCache"] as Record<string, unknown>) ?? {};
    if (vid && cache[vid]) {
      delete cache[vid];
      await chrome.storage.local.set({ tldwSummaryCache: cache });
    }
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
  await maybeStartDirectApiRun({ forceRun });
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
    onClick: () => void chrome.runtime.sendMessage({ type: "OPEN_OR_FOCUS_DESTINATION" }),
  });

  // 🧹 Clear cache — drop THIS video's cached summary and start fresh.
  menuItems.push({
    label: "🧹 Clear cache",
    title: "Remove this video's cached summary and start fresh",
    danger: true,
    onClick: () => { void regenerateSummary(vid, {}); },
  });

  // Source / Cached badge as a menu row — honest about origin, pointing where it
  // makes sense. When Direct API isn't set up, offer the "Get instant results"
  // setup nudge instead (the free headless path: no tab, no wait).
  if (tldw.source === "cached") {
    menuItems.push({
      label: "💾 Cached — manage",
      title: "Served from your saved cache (a stored earlier result — not a fresh call). Click to manage cached summaries.",
      onClick: () => void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "settings" }),
    });
  } else if (tldw.source) {
    menuItems.push({
      label: `⚡ ${tldw.source}`,
      title: "This summary came straight from the Gemini API — instant, no tab. Click for Direct API settings.",
      onClick: () => void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "directapi" }),
    });
  } else if (!currentDirectApiEnabled) {
    menuItems.push({
      label: "⚡ Get instant results",
      title: "Get summaries instantly from the free Gemini API — no tab opens, no waiting. Click to set it up.",
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

/** Confirmation overlay shown before enabling auto-run for a channel. */
function showAutoRunConfirmOverlay(
  info: ChannelInfo,
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


// --- auto TL;DW ----------------------------------------------------------

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  void chrome.runtime.sendMessage({ type: "ASK" }).catch(() => { /* best effort */ });
  return true;
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
async function maybeStartDirectApiRun(opts: { forceRun?: boolean } = {}): Promise<void> {
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

  const r = await chrome.storage.local.get(["settings", "tldwSummaryCache", AUTO_RUN_CHANNELS_KEY]);
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
  // cold video; a status cue during auto/cached runs).
  watchButtonAllowed = true;
  ensureWatchButton();

  const autoRunChannels = await readAutoRunChannels();
  if (stale()) return;
  const channelEntry = currentChannelInfo
    ? autoRunChannels.find((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)
    : undefined;

  currentAutoRunSummary = channelEntry?.autoRunSummary ?? false;

  type CacheEntry = { tldw: TldwSummary; cachedAt: string };

  // Serve a cached result if fresh.
  const serveCached = (entry: CacheEntry) => {
    showSummaryPanel({ ...entry.tldw, source: "cached" }, vid);
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
    const freshR = await chrome.storage.local.get("tldwSummaryCache");
    if (stale()) { endRunInFlight(); return; }
    const freshCache = (freshR["tldwSummaryCache"] as Record<string, CacheEntry> | undefined)?.[vid];
    if (freshCache && Date.now() - new Date(freshCache.cachedAt).getTime() < CACHE_TTL_MS) {
      serveCached(freshCache);
      return;
    }
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
      await chrome.runtime.sendMessage({ type: "ASK", source: "page" });
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

/**
 * Threshold path: waits 2500ms so the video element has its duration, then
 * runs for videos over the configured length. Sends an ASK message with
 * source "auto": headless via Direct API when a key is configured, otherwise
 * opens a destination tab.
 */
async function autoRunIfLong(): Promise<void> {
  const vid = currentVideoId();
  // sendAutoAsk is the shared per-visit dedup with the channel auto-run path:
  // whichever fires first marks the video, so the two can't double-fire — but the
  // mark resets on navigation, so this threshold run isn't permanently blocked.
  if (!vid || summaryPanel || autoAskedVid === vid) return;

  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as Record<string, unknown> | undefined;
  const threshold = (s?.autoTldwMinutes as number) ?? 0;
  if (!threshold) return;

  const { durationSeconds } = getVideoMeta();
  if (!durationSeconds || durationSeconds / 60 < threshold) return;

  // Re-check after the await: a panel may have mounted, or we may have navigated.
  if (currentVideoId() !== vid || summaryPanel || autoAskedVid === vid) return;
  log("auto-running TL;DW for", Math.round(durationSeconds / 60), "min video");
  sendAutoAsk(vid);
}

// yt-navigate-finish doesn't fire for all YouTube SPA navigation types.
// Three-layer strategy: immediate (page load / refresh), event-based (when
// YouTube fires its own event), and 500ms polling (everything else).
let lastHandledUrl = "";

function onNavigate(): void {
  // Normalize to video ID so URL decorations added by YouTube (?t=123, &pp=…)
  // don't trigger a spurious re-run that wipes the panels.
  const vid = currentVideoId();
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
  activeTranscriptFetch = null;
  currentChannelInfo = null;
  currentAutoRunSummary = false;
  // Re-allow the inline button for the new video; maybeStartDirectApiRun flips it
  // back off if this video turns out to be a non-summarizable live stream.
  watchButtonAllowed = true;
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
setInterval(onNavigate, 500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === "GET_TRANSCRIPT") {
    log("transcript requested");
    void getTranscript().then((transcript) => sendResponse({ transcript }));
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
  if (type === "SET_SUMMARY") {
    const msg = message as { tldw?: TldwSummary; source?: string; videoId?: string };
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
      // Persist tab-scrape results so a refresh serves from cache instead of
      // re-opening a tab. Don't re-cache a result that itself came from cache.
      if (vid && msg.source !== "cached") void cacheScrapedSummary(vid, tldw);
      showSummaryPanel({ ...tldw, source: msg.source }, vid);
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
    const msg = message as { videoId?: string; reason?: string };
    if (!msg.videoId || msg.videoId === currentVideoId()) {
      if (runInFlight) {
        endRunInFlight();
        showSummaryErrorPanel(msg.reason);
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

export {};
