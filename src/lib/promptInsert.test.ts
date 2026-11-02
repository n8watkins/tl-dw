import { describe, expect, it } from "vitest";
import { insertedShare, promptInsertedWhole } from "./promptInsert";

const prompt = `Summarize this video.\n\n${"transcript words ".repeat(2000)}\n\nEnd with the ---TLDW--- block.`;

describe("promptInsertedWhole", () => {
  it("accepts the whole prompt, even with newlines turned into paragraphs", () => {
    expect(promptInsertedWhole(prompt.replace(/\n/g, ""), prompt)).toBe(true);
  });

  it("rejects a prompt the site cut short, though its start is there", () => {
    const cut = prompt.slice(0, 20_000);
    expect(cut.slice(0, 20)).toBe(prompt.slice(0, 20));
    expect(promptInsertedWhole(cut, prompt)).toBe(false);
  });

  it("rejects an empty composer", () => {
    expect(promptInsertedWhole("", prompt)).toBe(false);
  });

  it("reports how much of the prompt arrived", () => {
    expect(insertedShare(prompt.slice(0, prompt.length / 2), prompt)).toBeCloseTo(0.5, 1);
    expect(insertedShare(prompt, prompt)).toBe(1);
  });
});
