import { describe, expect, it } from "vitest";
import { cacheContextForScrape, findOpenSearchForVideo } from "./openSearchMatch";
import type { OpenSearch } from "../types";

function search(tabId: number, videoId: string, sourceTabId?: number): OpenSearch {
  return {
    tabId,
    sourceTabId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    destinationId: "gemini",
    destinationLabel: "Gemini",
    createdAt: "2026-11-02T00:00:00.000Z",
  };
}

describe("findOpenSearchForVideo", () => {
  it("never focuses another video's chat from the same YouTube tab", () => {
    // YouTube tab 7 sent video A, then navigated in-page to video B.
    const searches = [search(101, "videoA", 7)];
    expect(findOpenSearchForVideo(searches, "videoB", 7)).toBeUndefined();
  });

  it("matches on the video id, preferring the same YouTube tab", () => {
    const searches = [
      search(103, "videoB", 9), // newest: B from another YouTube tab
      search(102, "videoB", 7),
      search(101, "videoA", 7),
    ];
    expect(findOpenSearchForVideo(searches, "videoB", 7)?.tabId).toBe(102);
    expect(findOpenSearchForVideo(searches, "videoA", 7)?.tabId).toBe(101);
  });

  it("falls back to the newest search for the video from any tab", () => {
    const searches = [search(103, "videoB", 9), search(102, "videoB", 8)];
    expect(findOpenSearchForVideo(searches, "videoB", 7)?.tabId).toBe(103);
    expect(findOpenSearchForVideo(searches, "videoB")?.tabId).toBe(103);
  });

  it("matches nothing without a video id", () => {
    expect(findOpenSearchForVideo([search(101, "videoA", 7)], null, 7)).toBeUndefined();
  });
});

describe("cacheContextForScrape", () => {
  const context = {
    videoId: "new-video",
    promptFingerprint: "fp",
    profileId: "p",
    profileName: "Profile",
    modelOrDestination: "gemini",
  };
  const search = (over: Partial<OpenSearch>): OpenSearch => ({
    tabId: 7,
    sourceTabId: 1,
    videoUrl: "https://www.youtube.com/watch?v=new-video",
    destinationId: "gemini",
    destinationLabel: "Gemini",
    createdAt: "2026-11-02T00:00:00.000Z",
    cacheContext: context,
    ...over,
  });

  it("caches a scrape whose prompt carried this video's transcript", () => {
    expect(cacheContextForScrape(search({ transcriptVideoId: "new-video" }))).toEqual(context);
  });

  it("caches a scrape whose prompt had no transcript", () => {
    expect(cacheContextForScrape(search({}))).toEqual(context);
  });

  it("never caches a summary built on another video's transcript", () => {
    expect(cacheContextForScrape(search({ transcriptVideoId: "old-video" }))).toBeUndefined();
  });

  it("never caches under a video other than the one the search was for", () => {
    expect(
      cacheContextForScrape(search({ videoUrl: "https://www.youtube.com/watch?v=old-video" })),
    ).toBeUndefined();
  });

  it("caches nothing without a recorded search or context", () => {
    expect(cacheContextForScrape(undefined)).toBeUndefined();
    expect(cacheContextForScrape(search({ cacheContext: undefined }))).toBeUndefined();
  });
});
