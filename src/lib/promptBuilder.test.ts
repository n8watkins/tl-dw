import { describe, expect, it } from "vitest";
import { buildDestinationPrompt, buildDestinationPromptInfo, TLDW_REMINDER, TRANSCRIPT_TRUNCATED_NOTE } from "./promptBuilder";
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

  it("weaves active tags into the prompt before the TLDW block — F6", () => {
    const tags = [
      { id: "t1", label: "Citations", prompt: "Include the sources the video relies on." },
      { id: "t2", label: "Tutorial", prompt: "Frame the takeaways as step-by-step instructions." },
    ];
    const out = buildDestinationPrompt(
      profile, video, dest({ payload: "prompt", canWatch: true }), null, null, tags,
    );
    expect(out).toContain("Include the sources the video relies on.");
    expect(out).toContain("Frame the takeaways as step-by-step instructions.");
    // tag instructions come before the binding output block
    expect(out.indexOf("Frame the takeaways")).toBeLessThan(out.indexOf("---TLDW---"));
  });

  it("no-ops with no tags", () => {
    const withNone = buildDestinationPrompt(profile, video, dest({ payload: "prompt", canWatch: true }), null, null, []);
    const baseline = buildDestinationPrompt(profile, video, dest({ payload: "prompt", canWatch: true }));
    expect(withNone).toBe(baseline);
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
    // The binding output-format block comes BEFORE the transcript, so a site
    // that cuts a long message short keeps it, and a one-line reminder of the
    // format comes after the untrusted transcript so it stays the last word.
    expect(out.indexOf("---END TLDW---")).toBeLessThan(out.indexOf("<<<TRANSCRIPT START>>>"));
    expect(out.trimEnd().endsWith(TLDW_REMINDER)).toBe(true);
  });

  it("keeps a long transcript within the destination's limit, marked as truncated", () => {
    const words = Array.from({ length: 30_000 }, (_, i) => `word${i}`);
    const transcript = `${words.join(" ")}. The final conclusion is here.`;
    const out = buildDestinationPrompt(
      profile,
      video,
      dest({ payload: "prompt", canWatch: false, maxPromptChars: 30_000 }),
      transcript,
    );
    expect(out.length).toBeLessThanOrEqual(30_000);
    expect(out).toContain(TRANSCRIPT_TRUNCATED_NOTE);
    // The opening and the closing stretch survive; the cut is at word boundaries.
    expect(out).toContain("word0 word1 word2");
    expect(out).toContain("The final conclusion is here.");
    expect(out).not.toMatch(/ord\d+ wo\b/);
    // The instructions and the format block are intact, before the transcript.
    expect(out.startsWith("Summarize My Video at https://youtube.com/watch?v=abc")).toBe(true);
    expect(out.indexOf("---END TLDW---")).toBeLessThan(out.indexOf("<<<TRANSCRIPT START>>>"));
    expect(out.trimEnd().endsWith(TLDW_REMINDER)).toBe(true);
  });

  it("an explicit limit overrides the destination's (the Direct API takes more)", () => {
    const transcript = "x ".repeat(40_000);
    const out = buildDestinationPrompt(
      profile,
      video,
      dest({ payload: "prompt", canWatch: false, maxPromptChars: 30_000 }),
      transcript,
      null,
      null,
      { maxChars: 1_000_000 },
    );
    expect(out).toContain(transcript.trim());
    expect(out).not.toContain(TRANSCRIPT_TRUNCATED_NOTE);
  });

  it("leaves a transcript that fits untouched", () => {
    const out = buildDestinationPrompt(
      profile,
      video,
      dest({ payload: "prompt", canWatch: false, maxPromptChars: 30_000 }),
      "Short transcript.",
    );
    expect(out).toContain("Short transcript.");
    expect(out).not.toContain(TRANSCRIPT_TRUNCATED_NOTE);
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

describe("buildDestinationPromptInfo", () => {
  const video = { url: "https://www.youtube.com/watch?v=abc" };
  const site: Destination = { id: "s", label: "Site", url: "https://example.com", maxPromptChars: 6000 };

  it("reports whether the transcript fit", () => {
    const short = buildDestinationPromptInfo(profile, video, site, "short words", null, null);
    expect(short.truncated).toBe(false);
    expect(short.prompt).toContain("short words");
    const long = buildDestinationPromptInfo(profile, video, site, "word ".repeat(5000), null, null);
    expect(long.truncated).toBe(true);
    expect(long.prompt.length).toBeLessThanOrEqual(6000);
  });

  it("keeps only the start, labelled, when asked to send the first part", () => {
    const transcript = "start ".repeat(2000) + "ENDING";
    const { prompt, truncated } = buildDestinationPromptInfo(profile, video, site, transcript, null, null, { cut: "head" });
    expect(truncated).toBe(true);
    expect(prompt).toContain("only its first part is included");
    expect(prompt).toMatch(/the last \d+% of the transcript is left out/);
    expect(prompt).not.toContain("ENDING");
    expect(prompt.length).toBeLessThanOrEqual(6000);
  });

  it("fits a long transcript whole into the API budget", () => {
    const transcript = "word ".repeat(40_000);
    const { truncated, prompt } = buildDestinationPromptInfo(profile, video, site, transcript, null, null, { maxChars: 1_000_000 });
    expect(truncated).toBe(false);
    expect(prompt).toContain(transcript.trim());
  });
});
