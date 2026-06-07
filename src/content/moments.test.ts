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
});
