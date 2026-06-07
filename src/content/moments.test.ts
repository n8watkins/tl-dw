import { describe, expect, it } from "vitest";
import { deriveMoments } from "./moments";
import type { TimedSegment } from "./moments";

/** Build evenly-spaced segments across `span` seconds, one every `step`. */
function segments(span: number, step: number): TimedSegment[] {
  const out: TimedSegment[] = [];
  for (let s = 0; s < span; s += step) {
    out.push({ startSeconds: s, text: `Sentence at ${s} seconds describing topic ${s}.` });
  }
  return out;
}

describe("deriveMoments", () => {
  it("returns nothing for empty input", () => {
    expect(deriveMoments([], 600)).toEqual([]);
  });

  it("returns nothing when every segment is blank", () => {
    expect(deriveMoments([{ startSeconds: 0, text: "   " }], 600)).toEqual([]);
  });

  it("clamps the count to at most 10", () => {
    // 60 min / 3 min ≈ 20 windows, but the cap is 10.
    const moments = deriveMoments(segments(3600, 20), 3600);
    expect(moments.length).toBeLessThanOrEqual(10);
  });

  it("clamps the count to at least 4 for a short, dense video", () => {
    // 2 min would round to 1 window; the floor is 4.
    const moments = deriveMoments(segments(120, 5), 120);
    expect(moments.length).toBe(4);
  });

  it("anchors moments at non-decreasing timestamps", () => {
    const moments = deriveMoments(segments(1800, 15), 1800);
    const times = moments.map((m) => m.startSeconds);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("produces non-empty, trimmed labels within the length cap", () => {
    const moments = deriveMoments(segments(900, 10), 900);
    expect(moments.length).toBeGreaterThan(0);
    for (const m of moments) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.label.length).toBeLessThanOrEqual(90);
      expect(m.label).toBe(m.label.trim());
    }
  });

  it("falls back to last-segment time when duration is unknown", () => {
    const moments = deriveMoments(segments(600, 10), 0);
    expect(moments.length).toBeGreaterThanOrEqual(4);
  });

  it("strips spoken time references from labels", () => {
    const segs: TimedSegment[] = [
      { startSeconds: 0, text: "7 minutes, 34 seconds we discuss setup." },
      { startSeconds: 60, text: "At 1 minute we cover intro topics here." },
      { startSeconds: 120, text: "At 2 minutes and 30 seconds we show examples." },
      { startSeconds: 180, text: "Real content about machine learning techniques." },
      { startSeconds: 240, text: "Practical demonstration of the core algorithm." },
      { startSeconds: 300, text: "Summary of the key findings from the session." },
    ];
    const moments = deriveMoments(segs, 360);
    for (const m of moments) {
      expect(m.label).not.toMatch(/\d+\s+minutes?/i);
      expect(m.label).not.toMatch(/\d+\s+seconds?/i);
    }
  });

  it("strips embedded numeric timestamps and sound markers from labels", () => {
    const segs: TimedSegment[] = [
      { startSeconds: 0, text: "7:34 this is the main point of the introduction." },
      { startSeconds: 60, text: "[Music] background track plays during this section." },
      { startSeconds: 120, text: "♪ intro music ♪ followed by real spoken content." },
      { startSeconds: 180, text: "Final thoughts on the overall methodology used." },
      { startSeconds: 240, text: "Detailed analysis of performance metrics gathered." },
      { startSeconds: 300, text: "Conclusion summarising all findings from research." },
    ];
    const moments = deriveMoments(segs, 360);
    for (const m of moments) {
      expect(m.label).not.toMatch(/\d{1,2}:\d{2}/);
      expect(m.label).not.toMatch(/\[Music\]/i);
      expect(m.label).not.toContain("♪");
    }
  });
});
