import { destinationLabel } from "./constants";
import type { Settings } from "../types";

/**
 * TL;DW became Gemini-only in 1.4 (docs/DECISIONS.md). A user whose default
 * was ChatGPT, Claude or NotebookLM moves to Gemini, and the popup tells them
 * once, naming the site they had picked. Returns null when nothing changes.
 */
export function migrateToGeminiOnly(settings: Settings): Settings | null {
  if (!settings.destinationId || settings.destinationId === "gemini") return null;
  return {
    ...settings,
    destinationId: "gemini",
    retiredDestinationNotice: destinationLabel(settings.destinationId),
  };
}
