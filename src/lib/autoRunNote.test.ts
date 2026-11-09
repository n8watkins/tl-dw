import { describe, expect, it } from "vitest";
import { autoRunNote, usesOwnKey } from "./autoRunNote";

describe("autoRunNote", () => {
  it("talks about the API key only when there is one", () => {
    expect(autoRunNote(true).note).toMatch(/your Gemini API key/);
    expect(autoRunNote(true).action.target).toBe("api-usage");
    const noKey = autoRunNote(false);
    expect(noKey.note).not.toMatch(/uses your Gemini API key/);
    expect(noKey.note).toMatch(/background tab/);
    expect(noKey.action.target).toBe("key-setup");
  });

  it("counts a key only when Direct API is on and the key is set", () => {
    expect(usesOwnKey(undefined)).toBe(false);
    expect(usesOwnKey({ useDirectApi: true, geminiApiKey: "" })).toBe(false);
    expect(usesOwnKey({ useDirectApi: false, geminiApiKey: "k" })).toBe(false);
    expect(usesOwnKey({ useDirectApi: true, geminiApiKey: "k" })).toBe(true);
  });
});
