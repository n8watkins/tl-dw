import { describe, expect, it } from "vitest";
import { cannotAccessMessage, excerptNotice, linkNotice, MAX_TAB_PARTS, planSend, SIGN_IN_MESSAGE } from "./sendPlan";

describe("planSend: transcript first, the link only without one", () => {
  it("with a key: the whole transcript, notes per part when it's too long for one request, or Gemini watches", () => {
    expect(planSend({ useApi: true, hasTranscript: true, fitsOne: true })).toBe("api-transcript");
    expect(planSend({ useApi: true, hasTranscript: true, fitsOne: false })).toBe("api-transcript-long");
    expect(planSend({ useApi: true, hasTranscript: false, fitsOne: false })).toBe("api-video");
  });

  it("without a key: the transcript in one message, in parts, or (very long) its start and end", () => {
    expect(planSend({ useApi: false, hasTranscript: true, fitsOne: true })).toBe("tab-transcript");
    expect(planSend({ useApi: false, hasTranscript: true, fitsOne: false, partsNeeded: 3 })).toBe("tab-parts");
    expect(planSend({ useApi: false, hasTranscript: true, fitsOne: false, partsNeeded: MAX_TAB_PARTS + 1 })).toBe("tab-excerpt");
  });

  it("without a key and without a transcript: the link", () => {
    expect(planSend({ useApi: false, hasTranscript: false, fitsOne: false })).toBe("tab-link");
  });
});

describe("what the page says", () => {
  it("never claims Gemini watched anything without the API, and offers a key only without one", () => {
    for (const text of [excerptNotice(false), linkNotice(false), cannotAccessMessage(false)]) {
      expect(text).not.toMatch(/\bwatched\b|will watch/i);
      expect(text).toContain("Add a free API key");
    }
    expect(linkNotice(true)).not.toContain("API key");
  });

  it("asks a signed-out user to sign in, in the owner's words", () => {
    expect(SIGN_IN_MESSAGE).toBe("This video has no transcript. Sign in to Gemini to summarize it from the video.");
  });
});
