import { describe, expect, it } from "vitest";
import { COMPOSER_MISSING_REASON, fillFailureMessage } from "./fillFailure";

describe("fillFailureMessage", () => {
  it("promises the clipboard only when the copy worked", () => {
    const copied = fillFailureMessage({ site: "Gemini", keptPercent: 33, copied: true });
    expect(copied).toBe(
      "Gemini took only about 33% of the prompt (it was too long), so nothing was sent. " +
        "The full prompt is on your clipboard: paste it into the Gemini tab.",
    );
    const blocked = fillFailureMessage({ site: "Gemini", keptPercent: 33, copied: false });
    expect(blocked).not.toMatch(/clipboard|ready to paste/);
    expect(blocked).toContain('open the Gemini tab and click "Copy prompt", then paste it there.');
  });

  it("says plainly that a missing message box may mean being signed out, without nested parentheses", () => {
    const message = fillFailureMessage({ site: "Gemini", reason: COMPOSER_MISSING_REASON, copied: true });
    expect(message).toBe(
      "TL;DW couldn't fill the Gemini tab. Gemini never showed its message box. " +
        "If you're signed out, sign in there first. " +
        "The full prompt is on your clipboard: paste it into the Gemini tab.",
    );
    expect(message).not.toMatch(/\([^)]*\(/);
  });

  it("still reads as sentences with no reason or copy result", () => {
    expect(fillFailureMessage({ site: "Gemini" })).toBe("TL;DW couldn't fill the Gemini tab.");
  });
});
