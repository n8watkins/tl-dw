import type { TldwSummary } from "../types";

/** The labels that start a new field. Anything else with a colon is treated as
 *  continuation text, so an all-caps "API:" inside the prose doesn't truncate it. */
const TLDW_FIELDS = new Set(["VERDICT", "RATING", "SUMMARY", "DETAILS"]);

/**
 * Parse the VERDICT/RATING/SUMMARY/DETAILS lines from the inside of a TL;DW
 * block. Returns null if there's no SUMMARY. Tolerates Markdown the model adds
 * around the LABELS (e.g. "**SUMMARY:**") but preserves the VALUE text verbatim
 * so legitimate `*` `_` backticks in the prose aren't deleted.
 */
function parseFields(inner: string): TldwSummary | null {
  const fields: Record<string, string> = {};
  let key = "";
  for (const rawLine of inner.split("\n")) {
    // Detect the label on a copy with leading list/quote/markdown markers
    // removed, but take the VALUE from this same copy's capture group — markup is
    // only stripped from the START, not globally, so an emphasized phrase or an
    // identifier with underscores inside the value survives intact.
    const probe = rawLine.replace(/^[\s>+•-]*[*_`]*\s*/, "");
    const m = probe.match(/^([A-Z]+)[*_`]*\s*:\s*([\s\S]*)$/);
    if (m && TLDW_FIELDS.has(m[1])) {
      key = m[1];
      fields[key] = m[2].replace(/^[\s*_`]+/, "").trim();
    } else if (key && rawLine.trim() && !/^[\s*_`>+•-]+$/.test(rawLine)) {
      // Continuation line (not a new field, and not a bare markup/divider line
      // like "**" or "---" left over from a rendered block).
      fields[key] = (fields[key] ? fields[key] + " " : "") + rawLine.trim();
    }
  }
  if (!fields.SUMMARY) return null;
  const raw = fields.VERDICT ?? "";
  const verdict = /SKIP/i.test(raw) ? "SKIP" : /SKIM/i.test(raw) ? "SKIM" : "WATCH";
  return {
    verdict,
    summary: fields.SUMMARY,
    rating: fields.RATING ?? "",
    details: fields.DETAILS || undefined,
  };
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
export function parseTldwBlock(text: string): TldwSummary | null {
  const dash = "[-\\u2012-\\u2015\\u2212]";

  // 1) Fully-delimited blocks — prefer the LAST one that parses to a SUMMARY.
  //    Dashed form first (strict), then the dash-less Markdown-scrape form.
  const closedForms = [
    new RegExp(`${dash}{1,3}\\s*TLDW\\s*${dash}{1,3}([\\s\\S]*?)${dash}{1,3}\\s*END\\s+TLDW`, "g"),
    /\bTLDW\b([\s\S]*?)\bEND\s+TLDW\b/g,
  ];
  for (const re of closedForms) {
    let best: TldwSummary | null = null;
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
