import { describe, expect, it } from "vitest";
import { buildDestinationPrompt } from "./promptBuilder";
import type { Destination, PromptProfile, VideoContext } from "../types";

const profile: PromptProfile = {
  id: "tldw",
  name: "TL;DW",
  promptTemplate: "Summarize {{title}} at {{url}}",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const video: VideoContext = {
  url: "https://youtube.com/watch?v=abc",
  title: "My Video",
};

const dest = (over: Partial<Destination>): Destination => ({
  id: "x",
  label: "X",
  url: "https://x.example",
  ...over,
});

describe("buildDestinationPrompt", () => {
  it("link payload returns just the video URL", () => {
    const out = buildDestinationPrompt(profile, video, dest({ payload: "link" }), "TRANSCRIPT");
    expect(out).toBe(video.url);
  });

  it("source payload returns the transcript when present", () => {
    const out = buildDestinationPrompt(profile, video, dest({ payload: "source" }), "TRANSCRIPT");
    expect(out).toBe("TRANSCRIPT");
  });

  it("source payload falls back to the URL when there's no transcript", () => {
    const out = buildDestinationPrompt(profile, video, dest({ payload: "source" }), null);
    expect(out).toBe(video.url);
  });

  it("substitutes template variables for a chat prompt", () => {
    const out = buildDestinationPrompt(profile, video, dest({ payload: "prompt", canWatch: true }));
    // The substituted template leads; the structured TL;DW block is appended after.
    expect(out.startsWith("Summarize My Video at https://youtube.com/watch?v=abc")).toBe(true);
    expect(out).toContain("---TLDW---");
  });

  it("instructs the model to drop meta-framing (state substance directly) — F5", () => {
    const out = buildDestinationPrompt(profile, video, dest({ payload: "prompt", canWatch: true }));
    expect(out).toContain("Do NOT describe the video");
    // names the filler phrasings to avoid
    expect(out).toMatch(/provides \/ covers \/ explains/);
  });

  it("a watch-capable destination (Gemini) never appends the transcript", () => {
    const out = buildDestinationPrompt(
      profile,
      video,
      dest({ payload: "prompt", canWatch: true }),
      "TRANSCRIPT",
    );
    expect(out).not.toContain("TRANSCRIPT");
  });

  it("a non-watch chat destination appends the transcript (fenced) when given", () => {
    const out = buildDestinationPrompt(
      profile,
      video,
      dest({ payload: "prompt", canWatch: false }),
      "TRANSCRIPT",
    );
    expect(out).toContain("<<<TRANSCRIPT START>>>");
    expect(out).toContain("<<<TRANSCRIPT END>>>");
    expect(out).toContain("TRANSCRIPT");
    // The binding output-format block comes AFTER the untrusted transcript.
    expect(out.indexOf("<<<TRANSCRIPT END>>>")).toBeLessThan(out.indexOf("---TLDW---"));
  });

  it("a non-watch chat destination omits the transcript section when null", () => {
    const out = buildDestinationPrompt(
      profile,
      video,
      dest({ payload: "prompt", canWatch: false }),
      null,
    );
    expect(out).not.toContain("<<<TRANSCRIPT START>>>");
  });

  it("substitutes the curiosity into a template that has the placeholder", () => {
    const withVar: PromptProfile = { ...profile, promptTemplate: "Q: {{userCuriosity}}" };
    const out = buildDestinationPrompt(
      withVar,
      video,
      dest({ payload: "prompt", canWatch: true }),
      null,
      "what about pricing?",
    );
    expect(out.startsWith("Q: what about pricing?")).toBe(true);
    expect(out).toContain("---TLDW---");
  });

  it("appends the curiosity (labelled) when the template lacks the placeholder", () => {
    const out = buildDestinationPrompt(
      profile, // template is "Summarize {{title}} at {{url}}" — no curiosity var
      video,
      dest({ payload: "prompt", canWatch: true }),
      null,
      "what about pricing?",
    );
    expect(out).toContain("In particular, address this: what about pricing?");
  });

  it("ignores blank curiosity", () => {
    const out = buildDestinationPrompt(
      profile,
      video,
      dest({ payload: "prompt", canWatch: true }),
      null,
      "   ",
    );
    // Blank curiosity adds nothing — no labelled "address this" line appears.
    expect(out.startsWith("Summarize My Video at https://youtube.com/watch?v=abc")).toBe(true);
    expect(out).not.toContain("In particular, address this");
  });
});
