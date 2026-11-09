import { describe, expect, it } from "vitest";
import captions from "./__fixtures__/jobs-stanford-captions.json";
import {
  chunkSegments,
  formatClock,
  isTimed,
  parseClock,
  plainText,
  quoteNear,
  timedText,
  verifyTime,
  type Segment,
} from "./timedTranscript";

const segments = captions.segments as Segment[];

describe("clocks", () => {
  it("formats and parses m:ss and h:mm:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(156)).toBe("2:36");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(parseClock("2:36")).toBe(156);
    expect(parseClock("[1:02:03]")).toBe(3723);
    expect(parseClock("2:61")).toBeNull();
    expect(parseClock("-")).toBeNull();
  });
});

describe("timed text", () => {
  it("writes one [m:ss] line per caption and keeps the plain text unchanged", () => {
    const two = segments.slice(0, 2);
    expect(timedText(two).split("\n")).toHaveLength(2);
    expect(timedText(two)).toMatch(/^\[2:\d\d\] /);
    expect(plainText(two)).not.toMatch(/\[\d/);
  });

  it("counts a transcript as timed only when every line has an ordered start", () => {
    expect(isTimed(segments)).toBe(true);
    expect(isTimed([{ start: NaN, text: "a" }])).toBe(false);
    expect(isTimed([{ start: 10, text: "a" }, { start: 2, text: "b" }])).toBe(false);
    expect(isTimed([])).toBe(false);
  });
});

describe("the ±15 s check (real captions, Steve Jobs at Stanford)", () => {
  it("passes a quote said at the cited time, or spilling into the next line", () => {
    expect(verifyTime(156, "So I decided to drop out", segments, captions.lengthSeconds)).toBe(true);
    expect(verifyTime(307, "you can't connect the dots looking forward", segments)).toBe(true);
    // Cited 12 s early: still within 15 s.
    expect(verifyTime(295, "you can only connect them looking backwards", segments)).toBe(true);
    expect(verifyTime(868, "Stay Hungry. Stay Foolish.", segments)).toBe(true);
  });

  it("fails a real quote cited at the wrong time, a made-up quote, and a time past the end", () => {
    // The study's link-only answer put this line 1 to 2.5 minutes early.
    expect(verifyTime(220, "you can't connect the dots looking forward", segments)).toBe(false);
    expect(verifyTime(156, "follow your passion and the money will come", segments)).toBe(false);
    expect(verifyTime(5000, "Stay Hungry. Stay Foolish.", segments, captions.lengthSeconds)).toBe(false);
  });

  it("never passes a quote too short to tell from chance, or a missing one", () => {
    expect(quoteNear("drop out", 156, segments)).toBe(false);
    expect(verifyTime(156, undefined, segments)).toBe(false);
    expect(verifyTime(undefined, "So I decided to drop out", segments)).toBe(false);
  });

  it("refuses every time without a timed transcript", () => {
    expect(verifyTime(156, "So I decided to drop out", [])).toBe(false);
    expect(verifyTime(156, "So I decided to drop out", [{ start: NaN, text: "So I decided to drop out" }])).toBe(false);
  });
});

describe("chunkSegments", () => {
  it("keeps every line, in order, with each chunk under the limit", () => {
    const chunks = chunkSegments(segments, 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.flat()).toEqual(segments);
    for (const chunk of chunks) expect(timedText(chunk).length).toBeLessThanOrEqual(300);
  });
});
