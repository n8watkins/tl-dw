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
});
