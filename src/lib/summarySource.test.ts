import { describe, expect, it } from "vitest";
import { cachedSourceLabel, describeSummarySource } from "./summarySource";

describe("describeSummarySource", () => {
  it("labels a cached summary as cached, with its profile", () => {
    const item = describeSummarySource(cachedSourceLabel("Global Profile"), "cache");
    expect(item?.label).toBe("💾 Cached (Global Profile)");
    expect(item?.title).toMatch(/saved cache/);
    expect(item?.section).toBe("settings");
  });

  it("recognizes a cached label even without a kind", () => {
    expect(describeSummarySource("cached · Deep dive")?.label).toBe("💾 Cached (Deep dive)");
  });

  it("labels a Direct API summary as the Gemini API", () => {
    const item = describeSummarySource("Gemini API", "api");
    expect(item?.label).toBe("⚡ Gemini API");
    expect(item?.title).toMatch(/Gemini API/);
  });

  it("labels a tab-flow summary by its destination, not as the Gemini API", () => {
    const item = describeSummarySource("ChatGPT", "tab");
    expect(item?.label).toBe("💬 From ChatGPT");
    expect(item?.title).toMatch(/ChatGPT tab/);
    expect(item?.title).not.toMatch(/straight from the Gemini API/);
    // A tab-flow Gemini summary is not an API summary either.
    expect(describeSummarySource("Gemini", "tab")?.label).toBe("💬 From Gemini");
    expect(describeSummarySource("Gemini")?.label).toBe("💬 From Gemini");
  });

  it("shows nothing without a source", () => {
    expect(describeSummarySource(undefined)).toBeNull();
  });
});
