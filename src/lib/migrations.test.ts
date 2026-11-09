import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import { migrateToGeminiOnly } from "./migrations";

describe("migrateToGeminiOnly", () => {
  it("moves a ChatGPT, Claude or NotebookLM default to Gemini and keeps the name for a one-time note", () => {
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "chatgpt" })).toMatchObject({
      destinationId: "gemini",
      retiredDestinationNotice: "ChatGPT",
    });
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "notebooklm" })?.retiredDestinationNotice).toBe("NotebookLM");
  });

  it("leaves a Gemini user alone, so the note shows only once", () => {
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "gemini" })).toBeNull();
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "gemini", retiredDestinationNotice: "Claude" })).toBeNull();
  });
});
