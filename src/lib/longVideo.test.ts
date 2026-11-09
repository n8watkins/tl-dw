import { describe, expect, it } from "vitest";
import { geminiRequestBody, type GeminiRequest } from "./geminiApi";
import { summarizeTranscriptInParts, videoWindows, watchVideo } from "./longVideo";
import type { PromptProfile } from "../types";

const profile: PromptProfile = { id: "tldw", name: "Quick", layout: "quick", promptTemplate: "Summarize {{title}}", createdAt: "", updatedAt: "" };
const input = { profile, video: { url: "https://www.youtube.com/watch?v=abc", title: "Long talk" } };

function recorder(answers: (r: GeminiRequest, i: number) => string) {
  const calls: GeminiRequest[] = [];
  return { calls, ask: async (r: GeminiRequest) => { calls.push(r); return answers(r, calls.length - 1); } };
}

describe("videoWindows", () => {
  it("covers the whole video in stretches of at most two hours", () => {
    expect(videoWindows(5 * 3600)).toEqual([[0, 6000], [6000, 12000], [12000, 18000]]);
    expect(videoWindows(0)).toEqual([]);
  });
});

describe("summarizeTranscriptInParts", () => {
  it("makes timed notes for every part, then one summary of all of them", async () => {
    const { calls, ask } = recorder((_, i) => (i < 2 ? `- ${i}:10 | note ${i} | "said in part ${i}"` : "---TLDW---\nSUMMARY: s\n---END TLDW---"));
    const result = await summarizeTranscriptInParts(ask, input, ["[0:00] first part", "[1:00:00] second part"], true);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.prompt).toContain("part 1 of 2");
    expect(calls[1]!.prompt).toContain("[1:00:00] second part");
    expect(calls[2]!.prompt).toContain('Part 2:\n- 1:10 | note 1 | "said in part 1"');
    expect(result.text).toContain("SUMMARY: s");
  });
});

describe("watchVideo", () => {
  it("watches a video up to 2.5 hours in one request", async () => {
    const { calls, ask } = recorder(() => "ok");
    await watchVideo(ask, input, input.video.url, 2 * 3600);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.startSeconds).toBeUndefined();
  });

  it("watches a longer one in time ranges, then summarizes the notes", async () => {
    const { calls, ask } = recorder(() => "- a point");
    await watchVideo(ask, input, input.video.url, 5 * 3600);
    expect(calls).toHaveLength(4);
    expect(calls.slice(0, 3).map((c) => [c.startSeconds, c.endSeconds])).toEqual([[0, 6000], [6000, 12000], [12000, 18000]]);
    expect(calls[3]!.videoUrl).toBeUndefined();
    // The range reaches the API as the video part's videoMetadata.
    const body = geminiRequestBody(calls[1]!) as { contents: { parts: Record<string, unknown>[] }[] };
    expect(body.contents[0]!.parts[0]).toMatchObject({ videoMetadata: { startOffset: "6000s", endOffset: "12000s" } });
  });
});
