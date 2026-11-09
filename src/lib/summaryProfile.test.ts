import { describe, expect, it } from "vitest";
import { selectSummaryProfile } from "./summaryProfile";
import type { PromptProfile, Settings } from "../types";

const now = "2026-07-20T00:00:00.000Z";
const profiles: PromptProfile[] = ["default", "picked", "channel"].map((id) => ({
  id, name: id, promptTemplate: id, createdAt: now, updatedAt: now,
}));
const settings = { defaultProfileId: "default" } as Settings;

describe("selectSummaryProfile", () => {
  it("uses the profile picked for this run first", () => {
    expect(selectSummaryProfile(profiles, settings, "picked", "channel")?.id).toBe("picked");
  });

  it("then the channel's default style, then the default profile", () => {
    expect(selectSummaryProfile(profiles, settings, undefined, "channel")?.id).toBe("channel");
    expect(selectSummaryProfile(profiles, settings, undefined)?.id).toBe("default");
  });

  it("skips ids that no longer exist", () => {
    expect(selectSummaryProfile(profiles, settings, "deleted", "gone")?.id).toBe("default");
    expect(selectSummaryProfile(profiles, { } as Settings, undefined)?.id).toBe("default");
  });
});
