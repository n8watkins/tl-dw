import { describe, expect, it } from "vitest";
import { parseTldwBlock } from "./tldw";

const block = (body: string) => `Some preamble.\n\n---TLDW---\n${body}\n---END TLDW---`;

describe("parseTldwBlock", () => {
  it("parses a well-formed block", () => {
    const out = parseTldwBlock(
      block("VERDICT: WATCH\nRATING: 8\nSUMMARY: It's good.\nDETAILS: Because reasons."),
    );
    expect(out).toEqual({
      verdict: "WATCH",
      rating: "8",
      summary: "It's good.",
      details: "Because reasons.",
    });
  });

  it("returns null when there is no block at all", () => {
    expect(parseTldwBlock("just some prose with no markers")).toBeNull();
  });

  // #6 — Gemini frequently renders the field labels in Markdown bold.
  it("parses fields even when the labels are Markdown-bold", () => {
    const out = parseTldwBlock(
      "**---TLDW---**\n**VERDICT:** SKIP\n**RATING:** 3\n**SUMMARY:** Not worth it.\n**DETAILS:** Filler.\n**---END TLDW---**",
    );
    expect(out?.verdict).toBe("SKIP");
    expect(out?.rating).toBe("3");
    expect(out?.summary).toBe("Not worth it.");
    expect(out?.details).toBe("Filler.");
  });

  // #20 — response cut off at maxOutputTokens before the closing marker.
  it("parses a truncated block with no closing marker", () => {
    const out = parseTldwBlock(
      "---TLDW---\nVERDICT: SKIM\nRATING: 5\nSUMMARY: The gist is here.",
    );
    expect(out?.verdict).toBe("SKIM");
    expect(out?.summary).toBe("The gist is here.");
  });

  // #32 — an all-caps word + colon inside the prose must not be read as a field.
  it("keeps an all-caps 'LABEL:' inside SUMMARY/DETAILS as continuation text", () => {
    const out = parseTldwBlock(
      block(
        "VERDICT: WATCH\nSUMMARY: It explains the API. HTTP: the protocol it builds on.\nDETAILS: Solid.",
      ),
    );
    expect(out?.summary).toBe("It explains the API. HTTP: the protocol it builds on.");
    expect(out?.details).toBe("Solid.");
  });

  it("maps the verdict keyword case-insensitively and defaults to WATCH", () => {
    expect(parseTldwBlock(block("VERDICT: skip\nSUMMARY: x"))?.verdict).toBe("SKIP");
    expect(parseTldwBlock(block("VERDICT: anything else\nSUMMARY: x"))?.verdict).toBe("WATCH");
  });

  it("returns null when SUMMARY is missing", () => {
    expect(parseTldwBlock(block("VERDICT: WATCH\nRATING: 8"))).toBeNull();
  });

  // #2 — the model restates the format template, then gives the real block.
  it("prefers the LAST delimited block when the template is restated first", () => {
    const restated =
      "Here's the format I'll use:\n" +
      "---TLDW---\nVERDICT: WATCH, SKIM, or SKIP\nSUMMARY: [one sentence — the conclusion]\n---END TLDW---\n\n" +
      "Now the actual answer:\n" +
      "---TLDW---\nVERDICT: SKIP\nRATING: 2\nSUMMARY: The real takeaway is it's filler.\nDETAILS: Skip it.\n---END TLDW---";
    const out = parseTldwBlock(restated);
    expect(out?.verdict).toBe("SKIP");
    expect(out?.summary).toBe("The real takeaway is it's filler.");
  });

  // #7 — markdown inside the VALUE must be preserved, not deleted.
  it("preserves * _ ` inside the summary/details value", () => {
    const out = parseTldwBlock(
      block("VERDICT: WATCH\nSUMMARY: Use the AWS_SECRET_KEY env var with *care*.\nDETAILS: See `config.ts`."),
    );
    expect(out?.summary).toBe("Use the AWS_SECRET_KEY env var with *care*.");
    expect(out?.details).toBe("See `config.ts`.");
  });

  // #8 — a bare "TLDW" word in prose must not anchor the parse.
  it("ignores a bare 'TLDW' mention in the prose", () => {
    expect(parseTldwBlock("I'll give you the TLDW shortly. SUMMARY: not a real block")).toBeNull();
  });

  // Re-verify #7 follow-up — a value that STARTS with a markdown span (no bolded
  // label) must survive without a dangling delimiter.
  it("preserves a value that begins with a code/emph span (plain label)", () => {
    expect(parseTldwBlock(block("VERDICT: WATCH\nSUMMARY: `useEffect` is the focus here."))?.summary)
      .toBe("`useEffect` is the focus here.");
    expect(parseTldwBlock(block("VERDICT: WATCH\nSUMMARY: *Crucially*, the demo fails at 4:00."))?.summary)
      .toBe("*Crucially*, the demo fails at 4:00.");
  });

  // A bolded label whose value also starts with a span: strip only the label's
  // closing delimiter, keep the value's own markup.
  it("strips the bolded label's closing delimiter but keeps the value's span", () => {
    expect(parseTldwBlock("---TLDW---\n**SUMMARY:** `useEffect` matters.\n---END TLDW---")?.summary)
      .toBe("`useEffect` matters.");
  });
});
