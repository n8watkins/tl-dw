import { describe, expect, it } from "vitest";
import {
  emptySummaryCache,
  findCachedVariant,
  fingerprintPrompt,
  normalizeSummaryCache,
  pruneSummaryCache,
  upsertCachedVariant,
} from "./summaryCache";
import type { CachedSummary } from "../types";

function entry(overrides: Partial<CachedSummary> = {}): CachedSummary {
  return {
    videoId: "video",
    promptFingerprint: "fingerprint",
    tldw: { summary: "Summary" },
    profileId: "profile",
    profileName: "Profile",
    modelOrDestination: "gemini-3.1-flash-lite",
    createdAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("summary cache variants", () => {
  it("discards legacy video-only cache data", () => {
    expect(normalizeSummaryCache({ video: { cachedAt: "2026-07-20T12:00:00.000Z" } })).toEqual(emptySummaryCache());
  });

  it("returns only an exact fingerprint for an explicit lookup", () => {
    const cache = { version: 2 as const, entries: [entry(), entry({ promptFingerprint: "other" })] };
    expect(findCachedVariant(cache, "video", "fingerprint")?.promptFingerprint).toBe("fingerprint");
    expect(findCachedVariant(cache, "video", "missing")).toBeNull();
  });

  it("returns the newest variant for passive navigation", () => {
    const cache = {
      version: 2 as const,
      entries: [
        entry({ promptFingerprint: "old", createdAt: "2026-07-19T12:00:00.000Z" }),
        entry({ promptFingerprint: "new", profileName: "Newest", createdAt: "2026-07-20T12:00:00.000Z" }),
      ],
    };
    expect(findCachedVariant(cache, "video")?.profileName).toBe("Newest");
  });

  it("replaces the same video and fingerprint while retaining other variants", () => {
    const cache = { version: 2 as const, entries: [entry(), entry({ promptFingerprint: "other" })] };
    const updated = upsertCachedVariant(cache, entry({ tldw: { summary: "Regenerated" } }));
    expect(updated.entries).toHaveLength(2);
    expect(findCachedVariant(updated, "video", "fingerprint")?.tldw.summary).toBe("Regenerated");
  });

  it("expires stale variants", () => {
    const cache = { version: 2 as const, entries: [entry({ createdAt: "2026-07-01T00:00:00.000Z" })] };
    expect(pruneSummaryCache(cache, new Date("2026-07-20T00:00:00.000Z").getTime()).entries).toEqual([]);
  });

  it("caps the cache at 300 variants globally", () => {
    const entries = Array.from({ length: 301 }, (_, index) =>
      entry({
        videoId: `video-${index}`,
        promptFingerprint: `fingerprint-${index}`,
        createdAt: new Date(Date.UTC(2026, 6, 20, 12, 0, index)).toISOString(),
      }),
    );
    const pruned = pruneSummaryCache({ version: 2, entries }, new Date("2026-07-21T00:00:00.000Z").getTime());
    expect(pruned.entries).toHaveLength(300);
    expect(pruned.entries.some((candidate) => candidate.videoId === "video-0")).toBe(false);
  });

  it("fingerprints prompt and target", async () => {
    const a = await fingerprintPrompt("prompt", "gemini-3.1-flash-lite");
    expect(a).toHaveLength(64);
    expect(await fingerprintPrompt("changed", "gemini-3.1-flash-lite")).not.toBe(a);
    expect(await fingerprintPrompt("prompt", "another-model")).not.toBe(a);
  });
});
