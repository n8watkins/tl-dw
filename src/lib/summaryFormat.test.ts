import { describe, expect, it } from "vitest";
import captions from "./__fixtures__/jobs-stanford-captions.json";
import { checkTimes, formatInstructions, parseItem } from "./summaryFormat";
import { parseTldwBlock } from "./tldw";
import type { Segment } from "./timedTranscript";

const segments = captions.segments as Segment[];

describe("formatInstructions", () => {
  it("asks for times and quotes only when the transcript is timed", () => {
    const timed = formatInstructions("quick", { timed: true });
    expect(timed).toContain('- TIME | point, under 20 words | "QUOTE"');
    expect(timed).toContain("exactly 3");
    const plain = formatInstructions("quick", { timed: false });
    expect(plain).not.toContain("TIME");
    expect(plain).not.toContain("QUOTE");
  });

  it("gives each layout its own block", () => {
    expect(formatInstructions("research", { timed: true })).toContain("STATUS");
    expect(formatInstructions("research", { timed: true })).toContain("NOTE: Not covered:");
    expect(formatInstructions("learning", { timed: false })).toContain("QUESTIONS:\n- question | answer");
    expect(formatInstructions("tutorial", { timed: false })).toContain("NOTE: You'll need:");
  });

  it("scales the number of claims with the video's length", () => {
    expect(formatInstructions("research", { timed: false, durationSeconds: 300 })).toContain("POINTS: 3 claims");
    expect(formatInstructions("research", { timed: false, durationSeconds: 3600 })).toContain("POINTS: 6 to 8 claims");
  });
});

describe("parseItem", () => {
  it("reads time, text and quote, in any quote style", () => {
    expect(parseItem('- 2:36 | He dropped out of Reed. | "So I decided to drop out"', "quick")).toEqual({
      time: 156, text: "He dropped out of Reed.", quote: "So I decided to drop out",
    });
    expect(parseItem("• [5:07] | Trust the dots | “you can't connect the dots looking forward”", "quick")).toEqual({
      time: 307, text: "Trust the dots", quote: "you can't connect the dots looking forward",
    });
  });

  it("reads research tags, learning terms and tutorial steps", () => {
    expect(parseItem('- 3:08 | The input layer is 784 neurons | Shown | "784 neurons"', "research")).toMatchObject({
      text: "The input layer is 784 neurons", tag: "Shown",
    });
    expect(parseItem('- 3:25 | Activation | The number a neuron holds | "holds a number"', "learning")).toMatchObject({
      term: "Activation", text: "The number a neuron holds", time: 205,
    });
    expect(parseItem("2. Flatten the image into 784 inputs", "tutorial")).toEqual({ text: "Flatten the image into 784 inputs" });
  });

  it("takes a point without a time as just a point", () => {
    expect(parseItem("- - | A late run decides it.", "quick")).toEqual({ text: "A late run decides it." });
    expect(parseItem("- A late run decides it.", "quick")).toEqual({ text: "A late run decides it." });
  });
});

describe("a whole answer", () => {
  // As the Gemini web app's answer reads back: list markers become "-", and
  // it may run the label onto the same line as the summary.
  const answer = `Here you go.

---TLDW---
SUMMARY: Trust your intuition, do work you love, and remember death.
POINTS:
- 2:36 | He dropped out of Reed and trusted it would work out. | "So I decided to drop out and trust"
- 5:07 | You connect the dots only looking back. | "you can only connect them looking backwards"
- 3:40 | Death is life's change agent. | "death is very likely the single best invention"
---END TLDW---`;

  it("keeps a time only when its quote is said within 15 s of it, and never keeps the quote", () => {
    const parsed = parseTldwBlock(answer, "quick")!;
    expect(parsed.items).toHaveLength(3);
    const checked = checkTimes(parsed, segments, captions.lengthSeconds);
    expect(checked.items!.map((i) => i.time)).toEqual([156, 307, undefined]);
    expect(checked.items!.every((i) => i.quote === undefined)).toBe(true);
    expect(checked.timed).toBe(true);
  });

  it("shows no time at all without a timed transcript (link or watched video)", () => {
    const checked = checkTimes(parseTldwBlock(answer, "quick")!, null);
    expect(checked.items!.every((i) => i.time === undefined)).toBe(true);
    expect(checked.timed).toBe(false);
  });

  it("parses learning questions and a research note", () => {
    const learning = parseTldwBlock(`---TLDW---
SUMMARY: Three ideas carry the whole video.
POINTS:
- Activation | The number a neuron holds, 0 to 1.
QUESTIONS:
- Why does each neuron need a bias? | So it lights up only past a threshold.
---END TLDW---`, "learning")!;
    expect(learning.questions).toEqual([{ question: "Why does each neuron need a bias?", answer: "So it lights up only past a threshold." }]);
    expect(learning.items).toEqual([{ term: "Activation", text: "The number a neuron holds, 0 to 1." }]);
    const research = parseTldwBlock("---TLDW---\nSUMMARY: s\nPOINTS:\n- a | Shown\nNOTE: Not covered: how it learns.\n---END TLDW---", "research")!;
    expect(research.note).toBe("Not covered: how it learns.");
  });

  it("still reads a legacy SUMMARY/DETAILS answer", () => {
    expect(parseTldwBlock("---TLDW---\nSUMMARY: s\nDETAILS: d\n---END TLDW---")).toEqual({ summary: "s", details: "d" });
    expect(parseTldwBlock("---TLDW---\nSUMMARY: s\nDETAILS: d\n---END TLDW---", "quick")).toEqual({ summary: "s", layout: "quick", details: "d" });
  });
});

describe("what the Gemini web app really sends back (9 Nov 2026)", () => {
  it("reads a time glued to its text, behind a zero-width space", () => {
    expect(parseItem("\u200b- 3:06Input layer consists of 784 neurons representing pixels | Shown", "research")).toEqual({
      time: 186, text: "Input layer consists of 784 neurons representing pixels", tag: "Shown",
    });
  });

  it("joins a time left alone on its line to the line after it", () => {
    const parsed = parseTldwBlock(`---TLDW---
SUMMARY: Neural networks pass numbers through layers.
POINTS:
\u200b- 2:52
Neuron | A fundamental unit holding a single number between zero and one. | "a thing that holds a number"
\u200b- 9:18
Weight | A multiplier on each connection.
---END TLDW---`, "learning")!;
    expect(parsed.items).toEqual([
      { time: 172, term: "Neuron", text: "A fundamental unit holding a single number between zero and one.", quote: "a thing that holds a number" },
      { time: 558, term: "Weight", text: "A multiplier on each connection." },
    ]);
  });

  it("reads a list the app rendered as list items, and the NOTE after the last one", () => {
    const parsed = parseTldwBlock(`Gemini said

---TLDW---
SUMMARY: The video establishes the structure of a basic network.
POINTS:
- 3:02 | A neural network starts with 784 input neurons. | Shown | "For example the network starts with a bunch of neurons"
- 12:18 | This network has about 13,000 weights and biases. | Shown | "this network has almost exactly 13,000 total weights"
NOTE: Not covered: how the network learns.
---END TLDW---`, "research")!;
    expect(parsed.items?.map((i) => [i.time, i.tag])).toEqual([[182, "Shown"], [738, "Shown"]]);
    expect(parsed.note).toBe("Not covered: how the network learns.");
  });
});
