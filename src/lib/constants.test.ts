import { describe, expect, it } from "vitest";
import { extractVideoId, isYouTubeShortUrl, isYouTubeVideoUrl } from "./constants";

describe("YouTube URL helpers", () => {
  it("accept watch pages", () => {
    expect(isYouTubeVideoUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
    expect(isYouTubeVideoUrl("https://m.youtube.com/watch?v=abc123&t=5s")).toBe(true);
    expect(extractVideoId("https://www.youtube.com/watch?v=abc123&list=x")).toBe("abc123");
    expect(extractVideoId("https://youtu.be/abc123")).toBe("abc123");
  });

  it("reject Shorts entirely", () => {
    const short = "https://www.youtube.com/shorts/abc123";
    expect(isYouTubeVideoUrl(short)).toBe(false);
    expect(extractVideoId(short)).toBeNull();
    expect(isYouTubeShortUrl(short)).toBe(true);
    expect(isYouTubeShortUrl("https://www.youtube.com/watch?v=abc123")).toBe(false);
  });

  it("reject other pages and a watch URL with no id", () => {
    expect(isYouTubeVideoUrl("https://www.youtube.com/")).toBe(false);
    expect(isYouTubeVideoUrl("https://www.youtube.com/watch")).toBe(false);
    expect(isYouTubeVideoUrl("https://www.youtube.com/results?v=abc123")).toBe(false);
    expect(isYouTubeVideoUrl("https://example.com/watch?v=abc123")).toBe(false);
    expect(extractVideoId("https://www.youtube.com/watch?v=")).toBeNull();
    expect(isYouTubeVideoUrl(undefined)).toBe(false);
    expect(isYouTubeVideoUrl("not a url")).toBe(false);
  });
});
