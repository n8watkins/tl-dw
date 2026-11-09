/**
 * Pure parsers for YouTube transcript data. The content script feeds them the
 * network payloads the MAIN-world interceptor relays (youtube-intercept.ts) and
 * the text of the rendered transcript panel; keeping them DOM-free makes them
 * unit-testable.
 */

import { parseClock, type Segment } from "./timedTranscript";

/**
 * A transcript as read: the spoken text, and each caption line with its start
 * time. A line whose time couldn't be read has start NaN, so the transcript
 * then counts as untimed (see isTimed) and no time is ever shown from it.
 */
export type TranscriptRead = { text: string; segments: Segment[] };

/** Below this many characters a "transcript" is noise (an empty panel, a lone label). */
const MIN_TRANSCRIPT_CHARS = 20;

type SnippetLike = { simpleText?: string; runs?: { text?: string }[] };

function snippetText(snippet: SnippetLike | undefined): string {
  if (typeof snippet?.simpleText === "string") return snippet.simpleText;
  if (Array.isArray(snippet?.runs)) {
    return snippet.runs.map((r) => r?.text ?? "").join("");
  }
  return "";
}

function finish(parts: string[]): string | null {
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > MIN_TRANSCRIPT_CHARS ? text : null;
}

/** Depth-first walk over parsed JSON, calling `visit` on every object node. */
function walk(root: unknown, visit: (node: Record<string, unknown>) => void): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const record = node as Record<string, unknown>;
    visit(record);
    const keys = Object.keys(record);
    for (let i = keys.length - 1; i >= 0; i--) stack.push(record[keys[i]!]);
  }
}

/**
 * The classic `/youtubei/v1/get_transcript` InnerTube response: every segment
 * is a `transcriptSegmentRenderer` with a `snippet`.
 */
export function extractFromGetTranscript(root: unknown): TranscriptRead | null {
  const segments: Segment[] = [];
  walk(root, (record) => {
    const seg = record.transcriptSegmentRenderer as
      | { snippet?: SnippetLike; startMs?: unknown; startTimeText?: SnippetLike }
      | undefined;
    if (seg?.snippet) {
      const text = snippetText(seg.snippet);
      if (!text) return;
      const ms = Number(seg.startMs);
      const start = Number.isFinite(ms) && seg.startMs !== undefined && seg.startMs !== ""
        ? ms / 1000
        : parseClock(snippetText(seg.startTimeText)) ?? NaN;
      segments.push({ start, text });
    }
  });
  return read(segments);
}

/** The transcript from its lines, or null when it's noise. */
function read(segments: Segment[]): TranscriptRead | null {
  const text = finish(segments.map((s) => s.text));
  return text ? { text, segments } : null;
}

export type PanelTranscript = TranscriptRead & { videoId?: string };

/**
 * The current `/youtubei/v1/get_panel` response (the "modern transcript view",
 * 2026): each line is a `macroMarkersPanelItemViewModel` whose segment
 * (`transcriptSegmentViewModel`) holds the spoken text and whose tap command
 * seeks to `startTimeSeconds`. The same endpoint serves other engagement
 * panels, so a response with no transcript segments returns null. The video id
 * comes from those seek commands (`watchEndpoint.videoId`), which is exact even
 * when the response lands after an in-page navigation.
 */
export function extractFromGetPanel(root: unknown): PanelTranscript | null {
  const segments: Segment[] = [];
  let videoId: string | undefined;
  // The walk is depth-first and visits a panel item before the segment inside
  // it, so the item's start time is carried to that segment through this.
  let pendingStart = NaN;
  walk(root, (record) => {
    const item = record.macroMarkersPanelItemViewModel as
      | { onTap?: { innertubeCommand?: { watchEndpoint?: { startTimeSeconds?: unknown } } } }
      | undefined;
    if (item && typeof item === "object") {
      // Remember this line's time for the segment found inside it.
      pendingStart = Number(item.onTap?.innertubeCommand?.watchEndpoint?.startTimeSeconds);
    }
    const seg = record.transcriptSegmentViewModel as (SnippetLike & { timestamp?: unknown }) | undefined;
    if (seg && typeof seg === "object") {
      const text = snippetText(seg);
      if (text) {
        const start = Number.isFinite(pendingStart)
          ? pendingStart
          : parseClock(typeof seg.timestamp === "string" ? seg.timestamp : "") ?? NaN;
        segments.push({ start, text });
      }
      pendingStart = NaN;
    }
    if (!videoId) {
      const endpoint = record.watchEndpoint as { videoId?: unknown } | undefined;
      if (endpoint && typeof endpoint.videoId === "string" && endpoint.videoId) {
        videoId = endpoint.videoId;
      }
    }
  });
  const transcript = read(segments);
  return transcript ? { ...transcript, videoId } : null;
}

/** Parse a timedtext response, either json3 or the legacy XML. */
export function extractFromTimedText(body: unknown): TranscriptRead | null {
  if (typeof body !== "string" || !body) return null;

  if (body.trimStart().startsWith("{")) {
    try {
      const json = JSON.parse(body) as {
        events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
      };
      const segments = (json.events ?? [])
        .filter((e) => Array.isArray(e.segs))
        .map((e) => ({
          start: typeof e.tStartMs === "number" ? e.tStartMs / 1000 : NaN,
          text: (e.segs ?? []).map((seg) => seg.utf8 ?? "").join("").replace(/\s+/g, " ").trim(),
        }))
        .filter((seg) => seg.text);
      return read(segments);
    } catch {
      return null;
    }
  }

  const segments: Segment[] = [];
  for (const m of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const start = Number((m[1] ?? "").match(/\bstart="([\d.]+)"/)?.[1] ?? NaN);
    const text = decodeEntities(m[2] ?? "").replace(/\s+/g, " ").trim();
    if (text) segments.push({ start, text });
  }
  return read(segments);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const CLOCK = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
// The panel's screen-reader label for a segment's start time, e.g. "1 second",
// "18 seconds", "1 minute, 5 seconds", "2 hours 3 minutes 4 seconds".
const SPOKEN_UNIT = String.raw`\d+\s+(?:hours?|minutes?|seconds?)`;
const LEADING_TIME_LABELS = new RegExp(
  String.raw`^(?:${CLOCK}|${SPOKEN_UNIT})(?:[\s,]*(?:${CLOCK}|${SPOKEN_UNIT}))*[\s,]*`,
  "i",
);

/**
 * Text of one rendered transcript segment with its leading time labels removed:
 * the visible clock ("0:18", "1:02:03") and the spoken accessibility label
 * ("18 seconds", "1 minute, 5 seconds") that the modern panel renders next to
 * it (the two are adjacent in the markup, so the raw text reads "0:181 second...").
 * The content script prefers the segment's own text element; this is the
 * fallback when only the whole segment's text is available.
 */
export function stripSegmentTimeLabels(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(LEADING_TIME_LABELS, "").trim();
}

/** Join cleaned segment texts into one transcript (null when there's nothing). */
export function joinSegments(lines: string[]): string | null {
  const kept = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (kept.length === 0) return null;
  return kept.join(" ");
}

/**
 * The InnerTube get_panel `params` for a video's modern transcript panel: the
 * protobuf message { 149: { 1: videoId, 3: 2 } }, base64-encoded, as YouTube's
 * web client sends it (seen 2026-11-02).
 */
export function transcriptPanelParams(videoId: string): string {
  const id = [...new TextEncoder().encode(videoId)];
  const inner = [0x0a, id.length, ...id, 0x18, 0x02];
  return btoa(String.fromCharCode(0xaa, 0x09, inner.length, ...inner));
}
