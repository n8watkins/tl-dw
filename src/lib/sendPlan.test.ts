import { describe, expect, it } from "vitest";
import { getDestination } from "./constants";
import { excerptLabel, excerptNotice, noTranscriptLinkNotice, planSend, publicInfoLabel } from "./sendPlan";

const gemini = getDestination("gemini");
const chatgpt = getDestination("chatgpt");
const notebooklm = getDestination("notebooklm");

describe("planSend", () => {
  it("uses the API with the whole transcript, or has Gemini watch the video when there is none", () => {
    expect(planSend({ useApi: true, destination: gemini, hasTranscript: true, transcriptFits: true })).toBe("api-transcript");
    expect(planSend({ useApi: true, destination: gemini, hasTranscript: false, transcriptFits: false })).toBe("api-video");
    expect(planSend({ useApi: true, destination: gemini, hasTranscript: true, transcriptFits: false })).toBe("api-too-long");
  });

  it("sends the Gemini tab part of a long transcript, and the link only when there is no transcript", () => {
    expect(planSend({ useApi: false, destination: gemini, hasTranscript: true, transcriptFits: true })).toBe("tab-transcript");
    expect(planSend({ useApi: false, destination: gemini, hasTranscript: true, transcriptFits: false })).toBe("tab-excerpt");
    expect(planSend({ useApi: false, destination: gemini, hasTranscript: false, transcriptFits: false })).toBe("tab-link");
  });

  it("asks the page what to do when a site that can't watch YouTube can't take the transcript", () => {
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: true, transcriptFits: true })).toBe("tab-transcript");
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: true, transcriptFits: false })).toBe("choose-long");
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: false, transcriptFits: false })).toBe("choose-no-transcript");
  });

  it("cuts a transcript for ChatGPT or Claude only when the user explicitly chose to send part of it", () => {
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: true, transcriptFits: false, allowTruncate: true }))
      .toBe("tab-excerpt");
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: false, transcriptFits: false, allowTruncate: true }))
      .toBe("choose-no-transcript");
  });

  it("labels a summary honestly: never \"watched\" without the API, and key advice only without a key", () => {
    expect(excerptLabel(false)).toBe(
      "Summarized from part of the transcript (video is long). Add a free API key to summarize the whole video.",
    );
    expect(excerptLabel(true)).toBe("Summarized from part of the transcript (video is long).");
    expect(publicInfoLabel(false)).toBe(
      "No transcript, so Gemini summarized from public info about this video, not the video itself. Add a free API key so Gemini can watch it.",
    );
    expect(publicInfoLabel(true)).not.toContain("API key");
    for (const text of [excerptLabel(false), publicInfoLabel(false), noTranscriptLinkNotice(false), excerptNotice("Gemini", false)]) {
      expect(text).not.toMatch(/\bwatched\b|will watch/i);
    }
  });

  it("leaves link destinations alone", () => {
    expect(planSend({ useApi: false, destination: notebooklm, hasTranscript: false, transcriptFits: false })).toBe("tab-plain");
  });
});
