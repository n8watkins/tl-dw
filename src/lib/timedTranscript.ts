/**
 * A transcript with the time each caption line starts, and the checks that
 * decide whether a time a model gives may be shown.
 *
 * TL;DW sends a timed transcript as one "[m:ss] text" line per caption, asks
 * for "m:ss | point | \"short quote\"", and shows a time only when those quoted
 * words are said within ±15 s of it (the timestamp study, 9 Nov 2026: 37 of 37
 * points cited from timed lines landed where the claim is made; without times
 * in the input, 10 of 15 were 35 s to 6 minutes off).
 */

export type Segment = {
  /** Start of the caption line, in seconds from the start of the video. */
  start: number;
  text: string;
};

/** How far a cited time may sit from where its quote is said. */
export const TIME_TOLERANCE_SECONDS = 15;

/** "m:ss", or "h:mm:ss" from an hour on. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "2:52", "1:02:03" or "[2:52]" in seconds; null when it isn't a clock. */
export function parseClock(text: string | null | undefined): number | null {
  const m = String(text ?? "").trim().match(/^\[?(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]?$/);
  if (!m) return null;
  const [, h, min, sec] = m;
  if (Number(sec) > 59 || (h !== undefined && Number(min) > 59)) return null;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec);
}

/** The spoken text alone, one line: what TL;DW sent before times were kept. */
export function plainText(segments: Segment[]): string {
  return segments.map((s) => s.text.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

/** One "[m:ss] text" line per caption: the form the model reads times from. */
export function timedText(segments: Segment[]): string {
  return segments
    .map((s) => ({ start: s.start, text: s.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text)
    .map((s) => `[${formatClock(s.start)}] ${s.text}`)
    .join("\n");
}

/**
 * Whether every segment has a usable start time and they run in order: only
 * then is a time the model cites from them checkable.
 */
export function isTimed(segments: Segment[] | null | undefined): segments is Segment[] {
  if (!segments || segments.length === 0) return false;
  let last = -1;
  for (const s of segments) {
    if (!Number.isFinite(s.start) || s.start < 0 || s.start + 1 < last) return false;
    last = s.start;
  }
  return true;
}

/** Lowercase words without punctuation, so "Stay hungry." matches "stay hungry". */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Whether `needle` occurs in `hay` as consecutive words. */
function containsRun(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The shortest quote worth checking: fewer words match by chance. */
const MIN_QUOTE_WORDS = 3;

/**
 * Whether `quote` is said within ±tolerance seconds of `seconds`: its words
 * appear, in order, in the captions that start in that window (plus the line
 * after it, where a sentence spills over). A quote of under three words can't
 * be told apart from chance, so it never passes.
 */
export function quoteNear(
  quote: string,
  seconds: number,
  segments: Segment[],
  tolerance = TIME_TOLERANCE_SECONDS,
): boolean {
  const q = words(quote);
  if (q.length < MIN_QUOTE_WORDS) return false;
  const inWindow: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (s.start < seconds - tolerance) continue;
    if (s.start > seconds + tolerance) {
      // The quote may begin in the window and run into the next line.
      inWindow.push(s);
      break;
    }
    inWindow.push(s);
  }
  if (inWindow.length === 0) return false;
  return containsRun(words(inWindow.map((s) => s.text).join(" ")), q);
}

/**
 * Whether a cited time may be shown: inside the video (when its length is
 * known) and the transcript's range, with its quote said within ±15 s.
 */
export function verifyTime(
  seconds: number | undefined,
  quote: string | undefined,
  segments: Segment[],
  durationSeconds = 0,
): boolean {
  if (seconds === undefined || !quote || !isTimed(segments)) return false;
  if (durationSeconds > 0 && seconds > durationSeconds + 1) return false;
  const last = segments[segments.length - 1]!.start;
  if (seconds < 0 || seconds > last + TIME_TOLERANCE_SECONDS) return false;
  return quoteNear(quote, seconds, segments);
}

/**
 * Split segments into consecutive chunks whose timed text stays under
 * `maxChars` each (a single over-long line gets a chunk of its own).
 */
export function chunkSegments(segments: Segment[], maxChars: number): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const s of segments) {
    const line = `[${formatClock(s.start)}] ${s.text}`.length + 1;
    if (current.length > 0 && size + line > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += line;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Split untimed text into pieces of at most `maxChars`, at word boundaries. */
export function splitPlainText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.8) cut = maxChars;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
