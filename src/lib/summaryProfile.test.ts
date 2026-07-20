import { describe, expect, it } from "vitest";
import { getDestination } from "./constants";
import { buildDestinationPrompt } from "./promptBuilder";
import { selectSummaryProfile } from "./summaryProfile";
import type { PromptProfile, Settings } from "../types";

const now = "2026-07-20T00:00:00.000Z";
const profiles: PromptProfile[] = [
  { id: "default", name: "Default", promptTemplate: "DEFAULT {{url}}", createdAt: now, updatedAt: now },
  { id: "automatic", name: "Automatic", promptTemplate: "AUTOMATIC {{url}}", createdAt: now, updatedAt: now },
  { id: "popup", name: "Popup", promptTemplate: "POPUP {{url}}", createdAt: now, updatedAt: now },
];
const settings = {
  defaultProfileId: "default",
  directApiProfileId: "automatic",
} as Settings;

describe("selectSummaryProfile", () => {
  it("uses the configured Direct API profile in the prompt for automatic runs", () => {
    const profile = selectSummaryProfile(profiles, settings, "auto", undefined, true)!;
    const prompt = buildDestinationPrompt(
      profile,
      { url: "https://www.youtube.com/watch?v=abc" },
      { ...getDestination("gemini"), canWatch: false },
      "transcript",
    );

    expect(profile.id).toBe("automatic");
    expect(prompt).toContain("AUTOMATIC https://www.youtube.com/watch?v=abc");
    expect(prompt).not.toContain("DEFAULT https://www.youtube.com/watch?v=abc");
  });

  it("does not overwrite the popup-selected profile for inline runs", () => {
    const profile = selectSummaryProfile(profiles, settings, "popup-inline", "popup", true);
    expect(profile?.id).toBe("popup");
  });

  it("uses the global default for a manual on-page run", () => {
    const profile = selectSummaryProfile(profiles, settings, "page", "automatic", true);
    expect(profile?.id).toBe("default");
  });

  it("keeps explicit profile selection for tab-opening entry points", () => {
    expect(selectSummaryProfile(profiles, settings, "menu", "popup", false)?.id).toBe("popup");
    expect(selectSummaryProfile(profiles, settings, "command", undefined, false)?.id).toBe("default");
  });
});
