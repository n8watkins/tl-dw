/**
 * What lands on the page for each profile, and the output format that asks
 * for it. Every profile ends its answer with one ---TLDW--- block; its layout
 * decides which parts the block has and how the panel draws them:
 *
 * - quick: the takeaway and three key points.
 * - research: claims, each tagged with how the video backs it, and what it leaves out.
 * - learning: the key ideas as cards, and two questions to test yourself.
 * - tutorial: numbered steps, and what you need first.
 *
 * Times ("m:ss") are asked for only when the model reads a timed transcript,
 * each with a short exact quote; the quote is how TL;DW checks the time before
 * it is shown (see timedTranscript.ts), and it is never displayed.
 */
import { parseClock, verifyTime, type Segment } from "./timedTranscript";
import type { SummaryItem, SummaryLayout, TldwSummary } from "../types";

export const SUMMARY_LAYOUTS: { id: SummaryLayout; label: string; description: string }[] = [
  { id: "quick", label: "Quick", description: "The takeaway and three key points." },
  { id: "research", label: "Research", description: "Claims, how the video backs each one, and what it leaves out." },
  { id: "learning", label: "Learning", description: "The key ideas as cards, and two questions to test yourself." },
  { id: "tutorial", label: "Tutorial", description: "Numbered steps, and what you need first." },
];

export function layoutOf(value: unknown): SummaryLayout {
  return SUMMARY_LAYOUTS.some((l) => l.id === value) ? (value as SummaryLayout) : "quick";
}

/** How many points suit a video of this length (unknown length: the middle). */
function pointRange(layout: SummaryLayout, durationSeconds: number): string {
  const minutes = durationSeconds / 60;
  if (layout === "quick") return "exactly 3";
  if (layout === "learning") return minutes > 30 ? "4 or 5" : "3 or 4";
  if (layout === "tutorial") return "3 to 8, as many as the real sequence has";
  if (!durationSeconds) return "4 or 5";
  return minutes < 10 ? "3" : minutes <= 30 ? "4 or 5" : "6 to 8";
}

export type FormatOptions = {
  /** The model reads a transcript with a [m:ss] time per line. */
  timed: boolean;
  /** The video's length, to scale the number of points (0 when unknown). */
  durationSeconds?: number;
};

const TIME_RULE =
  'TIME is the [m:ss] time of the transcript line where it is said, written as plain m:ss (no brackets). ' +
  'QUOTE is 4 to 10 words copied exactly from that line, in double quotes. Never invent a time or a quote.';

/**
 * The binding output instructions for `layout`: placed before the transcript,
 * and restated after it (formatReminder), so a long transcript can't push them
 * out of the model's attention.
 */
export function formatInstructions(layout: SummaryLayout, opts: FormatOptions): string {
  const n = pointRange(layout, opts.durationSeconds ?? 0);
  const t = opts.timed;
  const time = t ? "TIME | " : "";
  const quote = t ? ' | "QUOTE"' : "";
  let summary: string;
  let rule: string;
  let line: string;
  let extra = "";
  switch (layout) {
    case "research":
      summary = "one sentence: what the video establishes, and what it leaves open";
      rule =
        `POINTS: ${n} claims the video makes, in the order it makes them. STATUS is one of: Shown ` +
        "(it shows evidence), Stated (asserted without evidence), Opinion, or Check: a few words on why to verify it elsewhere.";
      line = `- ${time}claim, under 20 words | STATUS${quote}`;
      extra = "NOTE: Not covered: one line on what an informed viewer would expect that the video leaves out";
      break;
    case "learning":
      summary = "one sentence: the idea the whole video builds on";
      rule =
        `POINTS: ${n} key ideas, each a short TERM and a plain explanation a beginner understands. ` +
        "QUESTIONS: 2 questions that test understanding, each with a one-sentence answer from the video.";
      line = `- ${time}TERM | explanation, under 20 words${quote}`;
      extra = "QUESTIONS:\n- question | answer";
      break;
    case "tutorial":
      summary = "one sentence: what you will be able to do by following it";
      rule = `POINTS: ${n} steps in the order to do them, each an instruction starting with a verb.`;
      line = `- ${time}step, under 20 words${quote}`;
      extra = "NOTE: You'll need: the tools or knowledge to have first, or \"nothing special\"";
      break;
    default:
      summary = "one sharp sentence stating the video's real conclusion or claim";
      rule = `POINTS: ${n} key points, the most important first.`;
      line = `- ${time}point, under 20 words${quote}`;
  }
  return (
    "Respond with ONLY this block, formatted EXACTLY as shown, with no introduction: keep the labels, " +
    "the \"|\" separators and the --- lines literally, one item per line.\n\n" +
    "Write every line as a direct statement of what the video says: its claims, findings and advice. " +
    "Never describe the video or narrate what it does (\"the video explains / covers / discusses\"). " +
    "Write \"Fix conversion bottlenecks before scaling ad spend\", not \"The video focuses on fixing conversion bottlenecks.\"\n\n" +
    `${rule}\n` +
    (t ? `${TIME_RULE}\n` : "") +
    "\n---TLDW---\n" +
    `SUMMARY: ${summary}\n` +
    `POINTS:\n${line}\n${line}\n` +
    (extra ? `${extra}\n` : "") +
    "---END TLDW---"
  );
}

/** The one-line restatement placed after the transcript. */
export function formatReminder(timed: boolean): string {
  return (
    "Now answer the request above about this transcript with ONLY the ---TLDW--- block, " +
    "exactly as specified above" +
    (timed ? ', each point with its m:ss time and its exact "quote".' : ".")
  );
}

const QUOTE_CHARS = /^["“”„'‘’«»]+|["“”„'‘’«»]+$/g;

function isQuoted(part: string): boolean {
  return /^["“”„«]/.test(part.trim());
}

/** A point's time: "2:52", "[2:52]", "(2:52)"; undefined for "-" or none. */
function itemTime(part: string): number | undefined {
  const clock = parseClock(part.replace(/^\(|\)$/g, ""));
  return clock === null ? undefined : clock;
}

/** Zero-width characters the Gemini web app leaves in copied text. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/** A list line without its marker ("- ", "• ", "2. ") and invisible characters. */
function bare(raw: string): string {
  return raw.replace(ZERO_WIDTH, "").replace(/^\s*(?:[•*-]|\d{1,2}[.)])\s*/, "").trim();
}

/** A leading time, in any of the shapes models and renderers produce: "2:52 | x", "[2:52] x", "2:52x". */
const LEADING_TIME = /^[[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?(?![\d:])\s*(?:\|\s*)?/;

/** One "- TIME | ... | \"QUOTE\"" line as an item for `layout`, or null. */
export function parseItem(raw: string, layout: SummaryLayout): SummaryItem | null {
  let line = bare(raw);
  if (!line) return null;
  let time: number | undefined;
  const lead = line.match(LEADING_TIME);
  if (lead && line.length > lead[0].length) {
    time = itemTime(lead[1]!);
    line = line.slice(lead[0].length);
  } else {
    // A "no time" marker ("- | point") is dropped.
    line = line.replace(/^(?:[-–—]|n\/?a|none)\s*\|\s*/i, "");
  }
  const parts = line.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  let quote: string | undefined;
  if (parts.length > 1 && isQuoted(parts[parts.length - 1]!)) {
    quote = parts.pop()!.replace(QUOTE_CHARS, "").trim() || undefined;
  }
  if (parts.length === 0 || !parts[0]) return null;
  const item: SummaryItem = { text: parts[0] };
  if (layout === "research" && parts.length > 1) {
    item.tag = parts.slice(1).join(" | ");
  } else if (layout === "learning" && parts.length > 1) {
    item.term = parts[0];
    item.text = parts.slice(1).join(" | ");
  } else if (parts.length > 1) {
    item.text = parts.join(" | ");
  }
  if (time !== undefined) item.time = time;
  if (quote) item.quote = quote;
  return item;
}

/**
 * The item lines of a list field. A time the renderer left alone on its line
 * ("- 2:52", then "Neuron | ...") joins the line after it.
 */
export function itemLines(value: string | undefined): string[] {
  const out: string[] = [];
  let pendingTime = "";
  for (const raw of listLines(value)) {
    const line = bare(raw);
    if (!line) continue;
    if (/^[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*\|?$/.test(line)) {
      pendingTime = line.replace(/\s*\|$/, "");
      continue;
    }
    out.push(pendingTime ? `${pendingTime} | ${line}` : line);
    pendingTime = "";
  }
  return out;
}

/** The lines of a list field ("• a\n• b" or one line), without empties. */
export function listLines(value: string | undefined): string[] {
  if (!value) return [];
  return value.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Keep a point's time only when it passes the check against the timed
 * transcript TL;DW read itself; drop every quote either way. With no timed
 * transcript (the video was watched, or sent as a link), no time survives.
 */
export function checkTimes(
  tldw: TldwSummary,
  segments: Segment[] | null,
  durationSeconds = 0,
): TldwSummary {
  if (!tldw.items) return tldw;
  let kept = 0;
  const items = tldw.items.map((item) => {
    const ok = !!segments && verifyTime(item.time, item.quote, segments, durationSeconds);
    const next: SummaryItem = { ...item };
    delete next.quote;
    if (ok) kept++;
    else delete next.time;
    return next;
  });
  return { ...tldw, items, timed: kept > 0 };
}
