import type { TldwSummary } from "../types";

/**
 * Extract the structured ---TLDW--- block the prompt instructs the AI to
 * output. Shared between the inject content script and the background worker
 * (headless API path).
 */
export function parseTldwBlock(text: string): TldwSummary | null {
  // The headless API path reads raw text where the markers are literal
  // "---TLDW---". But when scraped from a chat UI, the response is rendered
  // Markdown — and Markdown turns "---" into an em-dash (—) or an <hr>, so the
  // visible text is "—TLDW—" or just "TLDW". Match any dash variant (or none),
  // with optional whitespace, so both paths parse. A final fallback handles the
  // case where the dashes were stripped entirely.
  const dash = "[-\\u2012-\\u2015\\u2212]{0,3}";
  const blockMatch =
    text.match(
      new RegExp(`${dash}\\s*TLDW\\s*${dash}([\\s\\S]*?)${dash}\\s*END\\s+TLDW\\s*${dash}`),
    ) ?? text.match(/\bTLDW\b([\s\S]*?)\bEND\s+TLDW\b/);
  if (!blockMatch) return null;

  const fields: Record<string, string> = {};
  let key = "";
  for (const line of blockMatch[1].split("\n")) {
    const kv = line.match(/^([A-Z]+):\s*(.*)/);
    if (kv) {
      key = kv[1];
      fields[key] = kv[2].trim();
    } else if (key && line.trim()) {
      fields[key] = (fields[key] ? fields[key] + " " : "") + line.trim();
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
