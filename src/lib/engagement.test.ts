import { describe, expect, it } from "vitest";
import { computeEngagementVerdict, VERDICT_RANK } from "./engagement";

const opts = { engagedPct: 60, skimmedPct: 15, sawSummary: false };
const withSummary = { ...opts, sawSummary: true };

describe("computeEngagementVerdict — zero/invalid duration", () => {
  it("returns null for duration 0", () => {
    expect(computeEngagementVerdict(100, 0, opts)).toBeNull();
  });
  it("returns null for NaN duration", () => {
    expect(computeEngagementVerdict(100, NaN, opts)).toBeNull();
  });
  it("returns null for negative duration", () => {
    expect(computeEngagementVerdict(100, -10, opts)).toBeNull();
  });
});

describe("computeEngagementVerdict — Engaged (watch)", () => {
  it("returns watch at exactly engagedPct", () => {
    // 60% of 100s = 60s watched
    expect(computeEngagementVerdict(60, 100, opts)).toBe("watch");
  });
  it("returns watch above engagedPct", () => {
    expect(computeEngagementVerdict(80, 100, opts)).toBe("watch");
  });
  it("returns watch below engagedPct but at 20-min absolute rule (1200s)", () => {
    // Video is 3000s long; watched 1200s = 40% (below 60% threshold)
    expect(computeEngagementVerdict(1200, 3000, opts)).toBe("watch");
  });
  it("returns watch above 1200s even if below pct threshold", () => {
    expect(computeEngagementVerdict(1500, 5000, opts)).toBe("watch");
  });
});

describe("computeEngagementVerdict — Skimmed (skim)", () => {
  it("returns skim at exactly skimmedPct", () => {
    // 15% of 100s = 15s watched
    expect(computeEngagementVerdict(15, 100, opts)).toBe("skim");
  });
  it("returns skim above skimmedPct but below engagedPct", () => {
    expect(computeEngagementVerdict(30, 100, opts)).toBe("skim");
  });
  it("returns skim just below engagedPct boundary", () => {
    // 59.9s of 100s = 59.9%
    expect(computeEngagementVerdict(59.9, 100, opts)).toBe("skim");
  });
});

describe("computeEngagementVerdict — Skipped (skip)", () => {
  it("returns skip below skimmedPct with sawSummary=true", () => {
    expect(computeEngagementVerdict(5, 100, withSummary)).toBe("skip");
  });
  it("returns skip below skimmedPct with >= 5s watched", () => {
    expect(computeEngagementVerdict(5, 100, opts)).toBe("skip");
  });
  it("returns skip with exactly 5s watched", () => {
    expect(computeEngagementVerdict(5, 100, opts)).toBe("skip");
  });
});

describe("computeEngagementVerdict — null (no signal)", () => {
  it("returns null when < 5s watched, no summary, below skim floor", () => {
    expect(computeEngagementVerdict(4.9, 100, opts)).toBeNull();
  });
  it("returns null when 0s watched and no summary", () => {
    expect(computeEngagementVerdict(0, 100, opts)).toBeNull();
  });
  it("returns skip (not null) when 0s watched but sawSummary=true", () => {
    expect(computeEngagementVerdict(0, 100, withSummary)).toBe("skip");
  });
});

describe("computeEngagementVerdict — boundary values", () => {
  it("exactly 15% is skim not skip", () => {
    expect(computeEngagementVerdict(15, 100, opts)).toBe("skim");
  });
  it("exactly 60% is watch not skim", () => {
    expect(computeEngagementVerdict(60, 100, opts)).toBe("watch");
  });
  it("14.99% is skip (with 5s threshold met)", () => {
    // 14.99% of 100s = 14.99s which is >=5s so qualifies as skip
    expect(computeEngagementVerdict(14.99, 100, opts)).toBe("skip");
  });
});

describe("VERDICT_RANK — upgrade-only ordering", () => {
  it("null < skip < skim < watch", () => {
    expect(VERDICT_RANK.null).toBeLessThan(VERDICT_RANK.skip);
    expect(VERDICT_RANK.skip).toBeLessThan(VERDICT_RANK.skim);
    expect(VERDICT_RANK.skim).toBeLessThan(VERDICT_RANK.watch);
  });
  it("watch has rank 3, skim 2, skip 1, null 0", () => {
    expect(VERDICT_RANK.watch).toBe(3);
    expect(VERDICT_RANK.skim).toBe(2);
    expect(VERDICT_RANK.skip).toBe(1);
    expect(VERDICT_RANK.null).toBe(0);
  });
});
