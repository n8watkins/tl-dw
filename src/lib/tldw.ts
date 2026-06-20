import type { TldwSummary } from "../types";

/**
 * Extract the structured ---TLDW--- block the prompt instructs the AI to
 * output. Shared between the inject content script and the background worker
 * (headless API path).
 */
/** The labels that start a new field. Anything else with a colon is treated as
 *  continuation text, so an all-caps "API:" inside the prose doesn't truncate it. */
const TLDW_FIELDS = new Set(["VERDICT", "RATING", "SUMMARY", "DETAILS"]);

export function parseTldwBlock(text: string): TldwSummary | null {
  // The headless API path reads raw text where the markers are literal
  // "---TLDW---". But when scraped from a chat UI, the response is rendered
  // Markdown — and Markdown turns "---" into an em-dash (—) or an <hr>, so the
  // visible text is "—TLDW—" or just "TLDW". Match any dash variant (or none),
  // with optional whitespace, so both paths parse.
  const dash = "[-\\u2012-\\u2015\\u2212]{0,3}";
  // Prefer the fully-delimited block (opening + closing marker). If the model
  // hit its maxOutputTokens cap before emitting the closing marker — common on
  // verbose profiles — fall back to parsing from the opening marker to
  // end-of-text so a complete VERDICT/SUMMARY still lands instead of timing out.
  const closed =
    text.match(
      new RegExp(`${dash}\\s*TLDW\\s*${dash}([\\s\\S]*?)${dash}\\s*END\\s+TLDW\\s*${dash}`),
    ) ?? text.match(/\bTLDW\b([\s\S]*?)\bEND\s+TLDW\b/);
  const open =
    text.match(new RegExp(`${dash}\\s*TLDW\\s*${dash}([\\s\\S]*)$`)) ??
    text.match(/\bTLDW\b([\s\S]*)$/);
  const inner = closed?.[1] ?? open?.[1];
  if (inner === undefined) return null;

  const fields: Record<string, string> = {};
  let key = "";
  for (const rawLine of inner.split("\n")) {
    // Tolerate Markdown the model adds around labels/values — e.g. "**SUMMARY:**"
    // renders the line starting with "*", which the old anchored regex missed,
    // dropping every field and returning null. Strip *, _, ` and any leading
    // list/quote marker before matching the label.
    const line = rawLine.replace(/[*_`]+/g, "").replace(/^\s*[>+\-•]\s*/, "").trim();
    const kv = line.match(/^([A-Z]+)\s*:\s*(.*)$/);
    if (kv && TLDW_FIELDS.has(kv[1])) {
      key = kv[1];
      fields[key] = kv[2].trim();
    } else if (key && line) {
      fields[key] = (fields[key] ? fields[key] + " " : "") + line;
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
