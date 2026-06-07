import type { TldwSummary } from "../types";

/**
 * Extract the structured ---TLDW--- block the prompt instructs the AI to
 * output. Shared between the inject content script and the background worker
 * (headless API path).
 */
export function parseTldwBlock(text: string): TldwSummary | null {
  const blockMatch = text.match(/---TLDW---([\s\S]*?)---END TLDW---/);
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
