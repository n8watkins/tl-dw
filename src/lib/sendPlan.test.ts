import { describe, expect, it } from "vitest";
import { getDestination } from "./constants";
import { planSend } from "./sendPlan";

const gemini = getDestination("gemini");
const chatgpt = getDestination("chatgpt");
const notebooklm = getDestination("notebooklm");

describe("planSend", () => {
  it("uses the API with the whole transcript, or has Gemini watch the video when there is none", () => {
    expect(planSend({ useApi: true, destination: gemini, hasTranscript: true, transcriptFits: true })).toBe("api-transcript");
    expect(planSend({ useApi: true, destination: gemini, hasTranscript: false, transcriptFits: false })).toBe("api-video");
    expect(planSend({ useApi: true, destination: gemini, hasTranscript: true, transcriptFits: false })).toBe("api-too-long");
  });

  it("sends the Gemini tab the link when the transcript is too long or missing, never a cut transcript", () => {
    expect(planSend({ useApi: false, destination: gemini, hasTranscript: true, transcriptFits: true })).toBe("tab-transcript");
    expect(planSend({ useApi: false, destination: gemini, hasTranscript: true, transcriptFits: false })).toBe("tab-link");
    expect(planSend({ useApi: false, destination: gemini, hasTranscript: false, transcriptFits: false })).toBe("tab-link");
  });

  it("asks the page what to do when a site that can't watch YouTube can't take the transcript", () => {
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: true, transcriptFits: true })).toBe("tab-transcript");
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: true, transcriptFits: false })).toBe("choose-long");
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: false, transcriptFits: false })).toBe("choose-no-transcript");
  });

  it("cuts a transcript only when the user explicitly chose to send the first part", () => {
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: true, transcriptFits: false, allowTruncate: true }))
      .toBe("tab-head");
    expect(planSend({ useApi: false, destination: chatgpt, hasTranscript: false, transcriptFits: false, allowTruncate: true }))
      .toBe("choose-no-transcript");
  });

  it("leaves link destinations alone", () => {
    expect(planSend({ useApi: false, destination: notebooklm, hasTranscript: false, transcriptFits: false })).toBe("tab-plain");
  });
});
