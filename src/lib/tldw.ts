import { itemLines, layoutOf, listLines, parseItem } from "./summaryFormat";
import type { SummaryLayout, TldwSummary } from "../types";

/** The labels that start a new field. Anything else with a colon is treated as
 *  continuation text, so an all-caps "API:" inside the prose doesn't truncate it.
 *  VERDICT/RATING are still recognized as field starts (so an older response or a
 *  user prompt that asks for them doesn't bleed those lines into the SUMMARY/DETAILS
 *  values), but TL;DW no longer requests or surfaces them. */
const TLDW_FIELDS = new Set(["VERDICT", "RATING", "SUMMARY", "DETAILS", "POINTS", "QUESTIONS", "NOTE"]);

/** Fields whose value is a list: every line stays its own item. */
const LIST_FIELDS = new Set(["POINTS", "QUESTIONS"]);

const FIELD_NAMES = [...TLDW_FIELDS].join("|");

/** A field label that starts a line (after list/quote markers and markdown). */
const LINE_START_FIELD = new RegExp(`^[\\s>+•-]*[*_\`]*\\s*(?:${FIELD_NAMES})\\b[*_\`]*\\s*:`, "m");

/**
 * Put every field label after the first on its own line. Models sometimes run
 * the next field onto the same line ("...plummet.DETAILS: ..."), and a reader
 * that lost the paragraph breaks does too, while the parser below is
 * line-based. Only an exact all-caps label followed by a colon counts, and only
 * where it starts a word, so "RETAILS:" or a lowercase "details:" in the prose
 * stay put. The first field must still start a line, so a stray "SUMMARY:" in
 * prose around a bare "TLDW" word can't start a block.
 */
const INLINE_FIELD = new RegExp(
  `(?<=[^\\s*_\`])[ \\t]*(?=[*_\`]*\\b(?:${FIELD_NAMES})\\b[*_\`]*\\s*:)`,
  "g",
);

function splitInlineFields(text: string): string {
  const first = LINE_START_FIELD.exec(text);
  if (!first) return text;
  const from = first.index + first[0].length;
  return text.slice(0, from) + text.slice(from).replace(INLINE_FIELD, "\n");
}

/** "- point", "* point", "• point" -> "• point"; "2. point" / "2) point" -> "2. point"; else null. */
function listItem(line: string): string | null {
  const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
  if (bullet) return `• ${bullet[1].trim()}`;
  const numbered = line.match(/^\s*(\d{1,2})[.)]\s+(.+)$/);
  if (numbered) return `${numbered[1]}. ${numbered[2].trim()}`;
  return null;
}

/**
 * Parse the SUMMARY/DETAILS lines from the inside of a TL;DW block. Returns null
 * if there's no SUMMARY. Tolerates Markdown the model adds around the LABELS
 * (e.g. "**SUMMARY:**") but preserves the VALUE text verbatim so legitimate
 * `*` `_` backticks in the prose aren't deleted.
 */
function parseFields(inner: string): RawFields | null {
  const fields: Record<string, string> = {};
  let key = "";
  for (const rawLine of splitInlineFields(inner).split("\n")) {
    // Capture: [leading list/quote markers][markdown around label] LABEL : value.
    // m[2] is the markdown that WRAPPED the label (e.g. the ** of "**SUMMARY:**").
    const m = rawLine.match(/^[\s>+•-]*([*_`]*)\s*([A-Z]+)[*_`]*\s*:\s*([\s\S]*)$/);
    const label = m?.[2];
    if (m && label && TLDW_FIELDS.has(label)) {
      key = label;
      let value = m[3];
      // Only when the label was itself wrapped in markdown does its CLOSING
      // delimiter leak into the value capture ("**SUMMARY:** x" → value "** x").
      // Strip just that leading run then. When the label was NOT wrapped, leave
      // the value untouched so a value that legitimately starts with `code` or
      // *emph* survives verbatim (the old global/leading strip mangled those).
      if (m[1]) value = value.replace(/^[*_`]+\s*/, "");
      fields[key] = value.trim();
    } else if (key && rawLine.trim() && !/^[\s*_`>+•-]+$/.test(rawLine)) {
      // Continuation line (not a new field, and not a bare markup/divider line
      // like "**" or "---" left over from a rendered block). A list item keeps
      // its own line ("- point" becomes "• point"; "1. point" stays numbered),
      // so the panel can show the list as a list; prose lines join with a space.
      const item = listItem(rawLine);
      const newline = !!item || LIST_FIELDS.has(key) || fields[key]?.includes("\n");
      fields[key] = (fields[key] ? fields[key] + (newline ? "\n" : " ") : "") + (item ?? rawLine.trim());
    }
  }
  if (!fields.SUMMARY) return null;
  // TL;DW no longer requests a verdict/rating; the panel and cache types keep the
  // fields optional, so a parsed summary just leaves them empty.
  const parsed: RawFields = { summary: fields.SUMMARY };
  if (fields.DETAILS) parsed.details = fields.DETAILS;
  if (fields.POINTS) parsed.points = fields.POINTS;
  if (fields.QUESTIONS) parsed.questions = fields.QUESTIONS;
  if (fields.NOTE) parsed.note = fields.NOTE;
  return parsed;
}

type RawFields = { summary: string; details?: string; points?: string; questions?: string; note?: string };

/** The parsed fields as a summary laid out for `layout` (none: the legacy shape). */
function shape(raw: RawFields, layout: SummaryLayout | undefined): TldwSummary {
  if (!layout) {
    const legacy: TldwSummary = { summary: raw.summary };
    // Points, when a model sent them, read as the details of the old shape.
    const details = raw.details ?? raw.points;
    if (details) legacy.details = details;
    return legacy;
  }
  const tldw: TldwSummary = { summary: raw.summary, layout };
  const items = itemLines(raw.points)
    .map((line) => parseItem(line, layout))
    .filter((item): item is NonNullable<typeof item> => !!item);
  if (items.length) tldw.items = items;
  const questions = listLines(raw.questions)
    .map((line) => {
      const [question, ...rest] = line.replace(/^\s*(?:[•*-]|\d{1,2}[.)])\s*/, "").split(/\s*\|\s*/);
      return { question: (question ?? "").trim(), answer: rest.join(" | ").trim() };
    })
    .filter((q) => q.question);
  if (questions.length) tldw.questions = questions;
  if (raw.note) tldw.note = raw.note;
  // A model that ignored the new format but wrote DETAILS still gets them shown.
  if (!items.length && raw.details) tldw.details = raw.details;
  return tldw;
}

/**
 * Extract the structured ---TLDW--- block the prompt instructs the AI to output.
 * Shared between the inject content script (Markdown-rendered scrape) and the
 * background worker (raw API text).
 *
 * Robustness the naive "first block wins" approach lacked:
 *  - Models frequently RESTATE the output-format template before the real
 *    answer, so prefer the LAST delimited block that yields a SUMMARY, not the
 *    first (which would store the placeholder "[one sentence — …]").
 *  - Require ≥1 dash adjacent to the TLDW marker so a bare "TLDW" word in the
 *    model's prose can't anchor the parse; the dash-less forms (for scraped
 *    Markdown where "---" became an <hr>/em-dash) are tried only as a fallback.
 *  - If the response was cut off at maxOutputTokens before the closing marker,
 *    parse from the LAST opening marker to end-of-text.
 */
export function parseTldwBlock(text: string, layout?: SummaryLayout | string): TldwSummary | null {
  const raw = parseRawBlock(text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, ""));
  return raw ? shape(raw, layout === undefined ? undefined : layoutOf(layout)) : null;
}

function parseRawBlock(text: string): RawFields | null {
  const dash = "[-\\u2012-\\u2015\\u2212]";

  // 1) Fully-delimited blocks — prefer the LAST one that parses to a SUMMARY.
  //    Dashed form first (strict), then the dash-less Markdown-scrape form.
  const closedForms = [
    new RegExp(`${dash}{1,3}\\s*TLDW\\s*${dash}{1,3}([\\s\\S]*?)${dash}{1,3}\\s*END\\s+TLDW`, "g"),
    /\bTLDW\b([\s\S]*?)\bEND\s+TLDW\b/g,
  ];
  for (const re of closedForms) {
    let best: RawFields | null = null;
    for (const m of text.matchAll(re)) {
      const parsed = parseFields(m[1]);
      if (parsed) best = parsed; // last valid wins
    }
    if (best) return best;
  }

  // 2) Truncated (no closing marker): parse from the LAST opening marker to end.
  const openForms = [
    new RegExp(`${dash}{1,3}\\s*TLDW\\s*${dash}{1,3}`, "g"),
    /\bTLDW\b/g,
  ];
  for (const re of openForms) {
    let lastEnd = -1;
    for (const m of text.matchAll(re)) {
      if (m.index !== undefined) lastEnd = m.index + m[0].length;
    }
    if (lastEnd !== -1) {
      const parsed = parseFields(text.slice(lastEnd));
      if (parsed) return parsed;
    }
  }
  return null;
}
