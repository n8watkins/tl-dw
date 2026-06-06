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

import { buildMomentsPanel, deriveMoments } from "./moments";
import type { TimedSegment } from "./moments";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log("[TL;DW]", ...args);

const currentVideoId = (): string | null =>
  new URLSearchParams(location.search).get("v");

// --- intercepted transcript cache ----------------------------------------

let captured: string | null = null;
let capturedTimed: TimedSegment[] | null = null;
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

  const timed =
    data.kind === "get_transcript"
      ? extractTimedFromGetTranscript(data.body)
      : data.kind === "timedtext"
        ? extractTimedFromTimedText(data.body)
        : null;

  if (text || timed) {
    if (text) captured = text;
    if (timed) capturedTimed = timed;
    capturedVideoId = currentVideoId();
    log(
      "intercepted transcript:",
      text?.length ?? 0,
      "chars,",
      timed?.length ?? 0,
      "timed segments",
    );
  }
});

function cachedForCurrentVideo(): string | null {
  return captured && capturedVideoId === currentVideoId() ? captured : null;
}

function cachedTimedForCurrentVideo(): TimedSegment[] | null {
  return capturedTimed && capturedVideoId === currentVideoId()
    ? capturedTimed
    : null;
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

/** Like extractFromGetTranscript, but keeps each segment's start time. */
function extractTimedFromGetTranscript(root: unknown): TimedSegment[] | null {
  const out: TimedSegment[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const seg = record.transcriptSegmentRenderer as
      | { snippet?: SnippetLike; startMs?: string }
      | undefined;
    if (seg?.snippet) {
      const text = snippetText(seg.snippet).replace(/\s+/g, " ").trim();
      const startMs = Number(seg.startMs);
      if (text && Number.isFinite(startMs)) {
        out.push({ startSeconds: startMs / 1000, text });
      }
    }
    for (const key in record) visit(record[key]);
  };
  visit(root);
  return out.length ? out : null;
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

/** Like extractFromTimedText, but keeps each cue's start time. */
function extractTimedFromTimedText(body: unknown): TimedSegment[] | null {
  if (typeof body !== "string" || !body) return null;

  if (body.trimStart().startsWith("{")) {
    try {
      const json = JSON.parse(body) as {
        events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
      };
      const out: TimedSegment[] = [];
      for (const e of json.events ?? []) {
        const text = (e.segs ?? [])
          .map((s) => s.utf8 ?? "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (text && typeof e.tStartMs === "number") {
          out.push({ startSeconds: e.tStartMs / 1000, text });
        }
      }
      return out.length ? out : null;
    } catch {
      return null;
    }
  }

  const out: TimedSegment[] = [];
  for (const m of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const start = /start="([\d.]+)"/.exec(m[1]);
    const text = decodeEntities(m[2]).replace(/\s+/g, " ").trim();
    if (text && start) out.push({ startSeconds: parseFloat(start[1]), text });
  }
  return out.length ? out : null;
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

function expandDescription(): void {
  document
    .querySelector<HTMLElement>(
      "ytd-text-inline-expander #expand, tp-yt-paper-button#expand, #description #expand, #expand",
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

/** Like scrapeRenderedTranscript, but keeps each segment's start time. */
function scrapeTimedRenderedTranscript(): TimedSegment[] | null {
  const out: TimedSegment[] = [];

  const modern = document.querySelectorAll(
    "transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost",
  );
  modern.forEach((seg) => {
    const raw = (seg.textContent ?? "").replace(/\s+/g, " ").trim();
    const m = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/.exec(raw);
    if (m && m[2]) out.push({ startSeconds: hmsToSeconds(m[1]), text: m[2].trim() });
  });
  if (out.length) return out;

  document.querySelectorAll("ytd-transcript-segment-renderer").forEach((seg) => {
    const ts = seg.querySelector(".segment-timestamp")?.textContent?.trim();
    const text = seg.querySelector(".segment-text")?.textContent?.trim();
    if (ts && text) out.push({ startSeconds: hmsToSeconds(ts), text });
  });
  return out.length ? out : null;
}

// --- request handling -----------------------------------------------------

/** Either source: intercepted network data, or the rendered panel. */
function available(): string | null {
  return cachedForCurrentVideo() ?? scrapeRenderedTranscript();
}

/** Timestamped equivalent of available(). */
function timedAvailable(): TimedSegment[] | null {
  return cachedTimedForCurrentVideo() ?? scrapeTimedRenderedTranscript();
}

/** Open YouTube's transcript panel so its segments render (and any fetch fires). */
async function openTranscriptPanel(): Promise<void> {
  expandDescription();
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
  } else {
    log("no 'Show transcript' button found");
  }
}

async function getTranscript(): Promise<string | null> {
  // Panel may already be open (or data already intercepted) — take it as-is so
  // we don't toggle an open panel shut.
  const immediate = available();
  if (immediate) {
    log("transcript ready:", immediate.length, "chars");
    return immediate;
  }

  await openTranscriptPanel();

  // Poll both sources until the lines appear.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(300);
    const hit = available();
    if (hit) {
      log("transcript captured:", hit.length, "chars");
      return hit;
    }
  }

  log("no transcript captured");
  return null;
}

/** The timestamped transcript, opening the panel if needed (for seek links). */
async function getTimedTranscript(): Promise<TimedSegment[] | null> {
  const immediate = timedAvailable();
  if (immediate) return immediate;

  await openTranscriptPanel();

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(300);
    const hit = timedAvailable();
    if (hit) {
      log("timed transcript captured:", hit.length, "segments");
      return hit;
    }
  }
  return null;
}

/** Parse "12:34" / "1:02:03" into seconds. */
function hmsToSeconds(text: string | null | undefined): number {
  if (!text) return 0;
  const parts = text.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Read the current video's duration (seconds) and channel name. */
function getVideoMeta(): { durationSeconds: number; channel: string } {
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
  return { durationSeconds, channel };
}

// --- key-moments panel (seek links) --------------------------------------

let momentsPanel: HTMLElement | null = null;

/** Move the player to a timestamp, keeping the current play/pause state. */
function seekTo(seconds: number): void {
  const video = document.querySelector<HTMLVideoElement>(
    "video.html5-main-video, video",
  );
  if (video) video.currentTime = seconds;
}

function removeMomentsPanel(): void {
  momentsPanel?.remove();
  momentsPanel = null;
}

/**
 * Toggle the on-page key-moments panel. Derives moments from the timestamped
 * transcript (no model, no reading any answer) and inserts the panel atop the
 * related-videos column. Returns a result the popup surfaces on failure.
 */
async function toggleMoments(): Promise<{ ok: boolean; reason?: string }> {
  if (momentsPanel) {
    removeMomentsPanel();
    return { ok: true };
  }

  const segments = await getTimedTranscript();
  if (!segments || segments.length === 0) {
    return { ok: false, reason: "no transcript" };
  }

  const { durationSeconds } = getVideoMeta();
  const moments = deriveMoments(segments, durationSeconds);
  if (moments.length === 0) return { ok: false, reason: "no moments" };

  const host =
    document.querySelector("#secondary-inner") ??
    document.querySelector("#secondary");
  if (!host) return { ok: false, reason: "no place to show the panel" };

  const panel = buildMomentsPanel(moments, {
    onSeek: seekTo,
    onClose: removeMomentsPanel,
  });
  host.prepend(panel);
  momentsPanel = panel;
  log("showing", moments.length, "moments");
  return { ok: true };
}

// A stale panel from the previous video shouldn't linger after SPA navigation.
window.addEventListener("yt-navigate-finish", removeMomentsPanel);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === "GET_TRANSCRIPT") {
    log("transcript requested");
    void getTranscript().then((transcript) => sendResponse({ transcript }));
    return true; // keep the channel open for the async response
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
  if (type === "TOGGLE_MOMENTS") {
    void toggleMoments().then((result) => sendResponse(result));
    return true; // async response
  }
  return false;
});

export {};
