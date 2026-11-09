import { describe, expect, it } from "vitest";
import {
  appendTranscript,
  buildFromNotesPrompt,
  buildLinkPrompt,
  buildNotesPrompt,
  buildPartPrompts,
  buildSummaryPrompt,
  buildWatchPrompt,
  CANNOT_ACCESS,
  promptForHistory,
  TRANSCRIPT_SHORTENED_NOTE,
} from "./promptBuilder";
import type { PromptProfile, VideoContext } from "../types";

const profile: PromptProfile = {
  id: "tldw",
  name: "Quick",
  layout: "quick",
  promptTemplate: "Summarize {{title}} at {{url}}",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const video: VideoContext = { url: "https://youtube.com/watch?v=abc", title: "My Video" };
const base = { profile, video };

describe("buildSummaryPrompt", () => {
  it("puts the guidance first and asks for the profile's own block", () => {
    const { prompt } = buildSummaryPrompt(base);
    expect(prompt.startsWith("Summarize My Video at https://youtube.com/watch?v=abc")).toBe(true);
    expect(prompt).toContain("---TLDW---");
    expect(prompt).toContain("POINTS:");
    expect(prompt).toContain("Respond with ONLY this block");
    // Never narrate what the video does.
    expect(prompt).toMatch(/explains \/ covers \/ discusses/);
  });

  it("each profile's layout asks for its own parts", () => {
    expect(buildSummaryPrompt({ ...base, profile: { ...profile, layout: "learning" } }).prompt).toContain("QUESTIONS:");
    expect(buildSummaryPrompt({ ...base, profile: { ...profile, layout: "tutorial" } }).prompt).toContain("You'll need:");
    expect(buildSummaryPrompt({ ...base, profile: { ...profile, layout: "research" } }).prompt).toContain("Not covered:");
  });

  it("asks for times and quotes only with a timed transcript, and says each line carries its time", () => {
    const timed = buildSummaryPrompt({ ...base, transcript: "[0:01] Hello there everyone.", timed: true }).prompt;
    expect(timed).toContain('TIME | point, under 20 words | "QUOTE"');
    expect(timed).toContain("Each line starts with the [m:ss] time it is said.");
    expect(timed.trimEnd().endsWith('its m:ss time and its exact "quote".')).toBe(true);
    const plain = buildSummaryPrompt({ ...base, transcript: "Hello there everyone.", timed: false }).prompt;
    expect(plain).not.toContain("QUOTE");
    expect(plain).not.toContain("[m:ss]");
  });

  it("puts the format before the fenced transcript, and the reminder last", () => {
    const { prompt } = buildSummaryPrompt({ ...base, transcript: "Words of the video." });
    expect(prompt.indexOf("---END TLDW---")).toBeLessThan(prompt.indexOf("<<<TRANSCRIPT START>>>"));
    expect(prompt.trimEnd().endsWith("exactly as specified above.")).toBe(true);
  });

  it("keeps a long transcript within the limit, start and end kept, the middle marked", () => {
    const transcript = "START " + "middle ".repeat(8000) + "ENDING";
    const { prompt, truncated } = buildSummaryPrompt({ ...base, transcript }, 30_000);
    expect(truncated).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(30_000);
    expect(prompt).toContain("START");
    expect(prompt).toContain("ENDING");
    expect(prompt).toContain(TRANSCRIPT_SHORTENED_NOTE);
    expect(prompt).toContain("its middle is left out where marked");
  });

  it("leaves a transcript that fits untouched", () => {
    const { prompt, truncated } = buildSummaryPrompt({ ...base, transcript: "word ".repeat(40_000) }, 1_000_000);
    expect(truncated).toBe(false);
    expect(prompt).not.toContain(TRANSCRIPT_SHORTENED_NOTE);
  });

  it("weaves in a question", () => {
    const { prompt } = buildSummaryPrompt({ ...base, userCuriosity: "what about pricing?" });
    expect(prompt).toContain("In particular, address this: what about pricing?");
    expect(prompt.indexOf("In particular")).toBeLessThan(prompt.indexOf("---TLDW---"));
    const withVar = buildSummaryPrompt({ ...base, profile: { ...profile, promptTemplate: "Q: {{userCuriosity}}" }, userCuriosity: "why?" });
    expect(withVar.prompt.startsWith("Q: why?")).toBe(true);
    expect(buildSummaryPrompt({ ...base, userCuriosity: "   " }).prompt).not.toContain("In particular");
  });
});

describe("link and watch prompts", () => {
  it("a link prompt names the video, offers CANNOT_ACCESS, and never asks for times", () => {
    const noUrl = { ...profile, promptTemplate: "Summarize {{title}}." };
    const prompt = buildLinkPrompt({ ...base, profile: noUrl });
    expect(prompt).toContain("Video link: https://youtube.com/watch?v=abc");
    expect(prompt).toContain(`reply with only the word ${CANNOT_ACCESS}`);
    expect(prompt).not.toContain("QUOTE");
    // A template that places {{url}} itself isn't given a second copy.
    expect(buildLinkPrompt(base).match(/watch\?v=abc/g)).toHaveLength(1);
  });

  it("a watch prompt asks Gemini to base everything on the attached video, without times", () => {
    const prompt = buildWatchPrompt(base);
    expect(prompt).toContain("Watch the attached video");
    expect(prompt).not.toContain("QUOTE");
  });
});

describe("long transcripts", () => {
  it("the Gemini tab gets every part, each asking only for an acknowledgement, then the request", () => {
    const { parts, final } = buildPartPrompts({ ...base, timed: true }, ["[0:00] one", "[9:00] two", "[18:00] three"]);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toContain('reply with only "Got part 2 of 3."');
    expect(parts[1]).toContain("<<<TRANSCRIPT PART 2 OF 3>>>\n[9:00] two");
    expect(final).toContain("The video's whole transcript is in the 3 parts I sent above");
    expect(final).toContain('"QUOTE"');
  });

  it("the API's notes keep checkable times, and the final request takes them from the notes", () => {
    expect(buildNotesPrompt(base, "[0:00] words", 0, 2, true)).toContain('- m:ss | point');
    const final = buildFromNotesPrompt(base, ["- 0:10 | a | \"q\"", "- 9:00 | b | \"r\""], true);
    expect(final).toContain("Part 2:\n- 9:00 | b");
    expect(final).toContain("take each point's time and quote from them exactly");
  });
});

describe("promptForHistory", () => {
  it("keeps the prompt that was sent and replaces only the transcript", () => {
    const transcript = "word ".repeat(2000).trim();
    const sent = appendTranscript("Summarize this video.", transcript) + "\n\n---\nReminder.";
    const kept = promptForHistory(sent);
    expect(kept).toContain("Summarize this video.");
    expect(kept).toContain("<<<TRANSCRIPT START>>>");
    expect(kept).toContain("Reminder.");
    expect(kept).toContain("9,999 characters, sent but not kept in History");
    expect(kept).not.toContain("word word");
  });

  it("leaves a link prompt unchanged", () => {
    const sent = "Summarize.\n\nVideo link: https://www.youtube.com/watch?v=x";
    expect(promptForHistory(sent)).toBe(sent);
  });
});
