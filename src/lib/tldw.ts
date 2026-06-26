import type { TldwSummary } from "../types";

/** The labels that start a new field. Anything else with a colon is treated as
 *  continuation text, so an all-caps "API:" inside the prose doesn't truncate it.
 *  VERDICT/RATING are still recognized as field starts (so an older response or a
 *  user prompt that asks for them doesn't bleed those lines into the SUMMARY/DETAILS
 *  values), but TL;DW no longer requests or surfaces them. */
const TLDW_FIELDS = new Set(["VERDICT", "RATING", "SUMMARY", "DETAILS"]);

/**
 * Parse the SUMMARY/DETAILS lines from the inside of a TL;DW block. Returns null
 * if there's no SUMMARY. Tolerates Markdown the model adds around the LABELS
 * (e.g. "**SUMMARY:**") but preserves the VALUE text verbatim so legitimate
 * `*` `_` backticks in the prose aren't deleted.
 */
function parseFields(inner: string): TldwSummary | null {
  const fields: Record<string, string> = {};
  let key = "";
  for (const rawLine of inner.split("\n")) {
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
      // like "**" or "---" left over from a rendered block).
      fields[key] = (fields[key] ? fields[key] + " " : "") + rawLine.trim();
    }
  }
  if (!fields.SUMMARY) return null;
  // TL;DW no longer requests a verdict/rating; the panel and cache types keep the
  // fields optional, so a parsed summary just leaves them empty.
  return {
    summary: fields.SUMMARY,
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
