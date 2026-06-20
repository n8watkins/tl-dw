import { describe, expect, it } from "vitest";
import {
  rangeFor,
  priorRange,
  windowStats,
  compareWindows,
  pctDelta,
  computeTimeSaved,
} from "./dashboards";
import { localDateKey } from "./constants";
import type { SearchHistoryEntry } from "../types";

// A fixed "now": Wed 2026-06-17 14:00 local.
const NOW = new Date(2026, 5, 17, 14, 0, 0);

function entry(over: Partial<SearchHistoryEntry> & { createdAt: string }): SearchHistoryEntry {
  return {
    id: over.createdAt + Math.random(),
    videoUrl: "https://youtube.com/watch?v=x",
    profileId: "p",
    profileName: "P",
    prompt: "",
    ...over,
  };
}

describe("rangeFor (calendar-aware, local)", () => {
  it("week starts Sunday and spans 7 days", () => {
    const r = rangeFor("week", NOW); // Wed 6/17 → week of Sun 6/14
    expect(localDateKey(r.start)).toBe("2026-06-14");
    expect(localDateKey(r.end)).toBe("2026-06-21"); // exclusive
    expect(r.start.getHours()).toBe(0);
  });
  it("month is the whole calendar month", () => {
    const r = rangeFor("month", NOW);
    expect(localDateKey(r.start)).toBe("2026-06-01");
    expect(localDateKey(r.end)).toBe("2026-07-01");
  });
  it("year is Jan 1 → next Jan 1", () => {
    const r = rangeFor("year", NOW);
    expect(localDateKey(r.start)).toBe("2026-01-01");
    expect(localDateKey(r.end)).toBe("2027-01-01");
  });
  it("handles month length correctly (Feb)", () => {
    const r = rangeFor("month", new Date(2024, 1, 10)); // Feb 2024 (leap)
    expect(localDateKey(r.start)).toBe("2024-02-01");
    expect(localDateKey(r.end)).toBe("2024-03-01");
  });
});

describe("priorRange", () => {
  it("prior week ends where the current week starts", () => {
    const cur = rangeFor("week", NOW);
    const prev = priorRange(cur, "week");
    expect(localDateKey(prev.start)).toBe("2026-06-07");
    expect(localDateKey(prev.end)).toBe("2026-06-14");
  });
  it("prior month is the previous calendar month (not 30 days)", () => {
    const cur = rangeFor("month", NOW);
    const prev = priorRange(cur, "month");
    expect(localDateKey(prev.start)).toBe("2026-05-01");
    expect(localDateKey(prev.end)).toBe("2026-06-01");
  });
});

describe("windowStats", () => {
  const activity = { "2026-06-15": 3, "2026-06-16": 1, "2026-06-08": 5 };
  const history = [
    entry({ createdAt: new Date(2026, 5, 15, 9).toISOString(), userRating: "skip", durationSeconds: 600, watchedSeconds: 60, channel: "A" }),
    entry({ createdAt: new Date(2026, 5, 16, 9).toISOString(), userRating: "watch", durationSeconds: 300, watchedSeconds: 300, channel: "A" }),
    entry({ createdAt: new Date(2026, 5, 16, 10).toISOString(), userRating: "skim", durationSeconds: 400, watchedSeconds: 100, channel: "B" }),
    entry({ createdAt: new Date(2026, 5, 8, 9).toISOString(), userRating: "skip", durationSeconds: 1000, watchedSeconds: 0, channel: "A" }), // last week
  ];

  it("filters by window and aggregates the rich metrics from history", () => {
    const s = windowStats(history, activity, rangeFor("week", NOW));
    expect(s.videosWithMeta).toBe(3); // the 6/8 entry is in the prior week
    expect(s.engagement).toEqual({ engaged: 1, skimmed: 1, skipped: 1 });
    // time saved: skip 600-60=540 + skim 400-100=300 = 840 (the watch entry doesn't count)
    expect(s.timeSavedSeconds).toBe(840);
    expect(s.hoursPreviewedSeconds).toBe(600 + 300 + 400);
    expect(s.uniqueChannels).toBe(2);
    expect(s.topChannels[0].channel).toBe("A"); // 2 vs 1
  });

  it("counts summaries + active days from the activity map", () => {
    const s = windowStats(history, activity, rangeFor("week", NOW));
    expect(s.summaries).toBe(4);   // 6/15 (3) + 6/16 (1)
    expect(s.activeDays).toBe(2);
    expect(s.totalDays).toBe(7);
  });

  // The timezone edge: an entry at 23:30 on the window's last day counts in it.
  it("counts a 23:30-local entry on the last in-window day", () => {
    const late = entry({ createdAt: new Date(2026, 5, 20, 23, 30).toISOString(), userRating: "watch", durationSeconds: 100, channel: "C" });
    const s = windowStats([late], {}, rangeFor("week", NOW)); // week is 6/14..6/21
    expect(s.videosWithMeta).toBe(1);
  });

  it("empty window → all zeros, no NaN/throw", () => {
    const s = windowStats([], {}, rangeFor("year", NOW));
    expect(s.summaries).toBe(0);
    expect(s.timeSavedSeconds).toBe(0);
    expect(s.engagement).toEqual({ engaged: 0, skimmed: 0, skipped: 0 });
    expect(s.uniqueChannels).toBe(0);
    expect(Number.isNaN(s.activeDays)).toBe(false);
  });
});

describe("compareWindows", () => {
  it("returns current + prior window stats", () => {
    const activity = { "2026-06-15": 2, "2026-06-08": 5 };
    const c = compareWindows([], activity, "week", NOW);
    expect(c.current.summaries).toBe(2); // this week
    expect(c.previous.summaries).toBe(5); // last week
  });
});

describe("pctDelta", () => {
  it("up / down / flat", () => {
    expect(pctDelta(15, 10).dir).toBe("up");
    expect(pctDelta(15, 10).pct).toBeCloseTo(50);
    expect(pctDelta(5, 10).dir).toBe("down");
    expect(pctDelta(10, 10).dir).toBe("flat");
  });
  it("'new' when there's no prior data; never returns ∞/NaN", () => {
    expect(pctDelta(8, 0)).toEqual({ pct: null, dir: "new" });
    expect(pctDelta(0, 0)).toEqual({ pct: null, dir: "flat" });
  });
});

describe("computeTimeSaved (moved from StatsSection)", () => {
  it("sums duration-watched for skim/skip only", () => {
    const h = [
      entry({ createdAt: "2026-06-15", userRating: "skip", durationSeconds: 600, watchedSeconds: 100 }),
      entry({ createdAt: "2026-06-15", userRating: "watch", durationSeconds: 600, watchedSeconds: 600 }),
      entry({ createdAt: "2026-06-15", userRating: "skim", durationSeconds: 200, watchedSeconds: 50 }),
    ];
    expect(computeTimeSaved(h)).toBe(500 + 150);
  });
});
