import { describe, expect, it } from "vitest";
import { trimActivity, verdictCounterDelta, watchedSecondsFromHistory } from "./storage";
import {
  engagedRatio,
  mostEngagedChannels,
  topChannelsByTime,
  trimChannelStats,
} from "./stats";
import type { ChannelStat, SearchHistoryEntry } from "../types";

// ---------------------------------------------------------------------------
// watchedSecondsFromHistory (F3 — restore watch progress on reload)
// ---------------------------------------------------------------------------

function hist(videoId: string, watchedSeconds?: number): SearchHistoryEntry {
  return {
    id: videoId,
    videoUrl: `https://youtube.com/watch?v=${videoId}`,
    profileId: "p",
    profileName: "P",
    prompt: "",
    watchedSeconds,
    createdAt: new Date().toISOString(),
  };
}

describe("watchedSecondsFromHistory", () => {
  it("returns 0 when the video has no history entry", () => {
    expect(watchedSecondsFromHistory([hist("aaa", 120)], "zzz")).toBe(0);
  });

  it("returns 0 when the entry has no watchedSeconds", () => {
    expect(watchedSecondsFromHistory([hist("aaa")], "aaa")).toBe(0);
  });

  it("returns the matching entry's watchedSeconds", () => {
    expect(watchedSecondsFromHistory([hist("aaa", 137)], "aaa")).toBe(137);
  });

  it("takes the max over all matching entries", () => {
    expect(watchedSecondsFromHistory([hist("aaa", 200), hist("aaa", 50)], "aaa")).toBe(200);
  });

  it("isn't shadowed by a newer summary entry that has no watchedSeconds", () => {
    // addHistoryEntry prepends a summary row (no watchedSeconds) over the stub
    // that holds the accumulated total — first-match would wrongly return 0.
    expect(watchedSecondsFromHistory([hist("aaa"), hist("aaa", 120)], "aaa")).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// trimActivity
// ---------------------------------------------------------------------------

describe("trimActivity — trim to the newest maxKeys dates", () => {
  it("returns the same object when at or below the cap", () => {
    const activity: Record<string, number> = { "2025-01-01": 1, "2025-01-02": 2 };
    const result = trimActivity(activity, 366);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("trims to the newest maxKeys dates when over the cap", () => {
    // Build 370 keys spanning 2024-01-01 through 2025-01-04 (days 0-369).
    const activity: Record<string, number> = {};
    for (let i = 0; i < 370; i++) {
      const d = new Date("2024-01-01");
      d.setDate(d.getDate() + i);
      activity[d.toISOString().slice(0, 10)] = i + 1;
    }
    const result = trimActivity(activity, 366);
    const keys = Object.keys(result).sort();
    expect(keys).toHaveLength(366);
    // The 4 oldest (2024-01-01 … 2024-01-03) should be gone; first kept is 2024-01-04.
    expect(keys[0]).toBe("2024-01-04");
    // The newest key is still present.
    expect(keys[365]).toBe("2025-01-04");
  });

  it("uses 400 as the default cap (covers the 53-week heatmap window)", () => {
    const activity: Record<string, number> = {};
    for (let i = 0; i < 450; i++) {
      const d = new Date("2024-01-01");
      d.setDate(d.getDate() + i);
      activity[d.toISOString().slice(0, 10)] = 1;
    }
    const result = trimActivity(activity);
    expect(Object.keys(result)).toHaveLength(400);
  });

  it("keeps values intact for retained keys", () => {
    const activity: Record<string, number> = { "2025-12-31": 42, "2025-12-30": 7 };
    const result = trimActivity(activity, 2);
    expect(result["2025-12-31"]).toBe(42);
    expect(result["2025-12-30"]).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// verdictCounterDelta
// ---------------------------------------------------------------------------

describe("verdictCounterDelta — first-time rating (no previous)", () => {
  it("increments engaged when transitioning undefined → watch", () => {
    expect(verdictCounterDelta(undefined, "watch")).toEqual({ engaged: 1, skimmed: 0, skipped: 0 });
  });

  it("increments skimmed when transitioning undefined → skim", () => {
    expect(verdictCounterDelta(undefined, "skim")).toEqual({ engaged: 0, skimmed: 1, skipped: 0 });
  });

  it("increments skipped when transitioning undefined → skip", () => {
    expect(verdictCounterDelta(undefined, "skip")).toEqual({ engaged: 0, skimmed: 0, skipped: 1 });
  });
});

describe("verdictCounterDelta — no-op when same rating", () => {
  it("returns all-zero delta for watch → watch", () => {
    expect(verdictCounterDelta("watch", "watch")).toEqual({ engaged: 0, skimmed: 0, skipped: 0 });
  });

  it("returns all-zero delta for skim → skim", () => {
    expect(verdictCounterDelta("skim", "skim")).toEqual({ engaged: 0, skimmed: 0, skipped: 0 });
  });

  it("returns all-zero delta for skip → skip", () => {
    expect(verdictCounterDelta("skip", "skip")).toEqual({ engaged: 0, skimmed: 0, skipped: 0 });
  });
});

describe("verdictCounterDelta — upgrade transitions", () => {
  it("skip → skim: decrements skipped, increments skimmed", () => {
    expect(verdictCounterDelta("skip", "skim")).toEqual({ engaged: 0, skimmed: 1, skipped: -1 });
  });

  it("skip → watch: decrements skipped, increments engaged", () => {
    expect(verdictCounterDelta("skip", "watch")).toEqual({ engaged: 1, skimmed: 0, skipped: -1 });
  });

  it("skim → watch: decrements skimmed, increments engaged", () => {
    expect(verdictCounterDelta("skim", "watch")).toEqual({ engaged: 1, skimmed: -1, skipped: 0 });
  });
});

// ---------------------------------------------------------------------------
// Per-channel stats (D13) — trim / rank / ratio
// ---------------------------------------------------------------------------

function ch(over: Partial<ChannelStat> & { name: string; lastWatched: string }): ChannelStat {
  return {
    secondsWatched: 0,
    videosWatched: 0,
    engaged: 0,
    skimmed: 0,
    skipped: 0,
    avatarUrl: undefined,
    ...over,
  };
}

describe("trimChannelStats — evict least-recently-watched", () => {
  it("returns the same map when at or below the cap", () => {
    const map = {
      a: ch({ name: "A", lastWatched: "2025-01-01T00:00:00Z" }),
      b: ch({ name: "B", lastWatched: "2025-01-02T00:00:00Z" }),
    };
    expect(trimChannelStats(map, 5)).toBe(map);
  });

  it("keeps only the newest `cap` channels by lastWatched", () => {
    const map: Record<string, ChannelStat> = {};
    for (let i = 0; i < 10; i++) {
      const d = new Date("2025-01-01T00:00:00Z");
      d.setDate(d.getDate() + i);
      map[`c${i}`] = ch({ name: `C${i}`, lastWatched: d.toISOString() });
    }
    const trimmed = trimChannelStats(map, 3);
    expect(Object.keys(trimmed).sort()).toEqual(["c7", "c8", "c9"]);
  });

  it("evicts entries with an unparseable lastWatched first (sorted oldest)", () => {
    const map = {
      good: ch({ name: "Good", lastWatched: "2025-06-01T00:00:00Z" }),
      bad: ch({ name: "Bad", lastWatched: "not-a-date" }),
    };
    const trimmed = trimChannelStats(map, 1);
    expect(Object.keys(trimmed)).toEqual(["good"]);
  });
});

describe("engagedRatio", () => {
  it("returns engaged / total-rated", () => {
    expect(engagedRatio(ch({ name: "A", lastWatched: "x", engaged: 3, skimmed: 1, skipped: 0 }))).toBe(0.75);
  });

  it("returns null when nothing is rated", () => {
    expect(engagedRatio(ch({ name: "A", lastWatched: "x" }))).toBeNull();
  });
});

describe("topChannelsByTime", () => {
  const map = {
    a: ch({ name: "A", lastWatched: "2025-01-01T00:00:00Z", secondsWatched: 100 }),
    b: ch({ name: "B", lastWatched: "2025-01-02T00:00:00Z", secondsWatched: 300 }),
    c: ch({ name: "C", lastWatched: "2025-01-03T00:00:00Z", secondsWatched: 0 }),
  };

  it("ranks by secondsWatched descending and drops zero-time channels", () => {
    const ranked = topChannelsByTime(map, 5);
    expect(ranked.map((r) => r.key)).toEqual(["b", "a"]);
    expect(ranked[0]!.name).toBe("B");
  });

  it("respects the limit", () => {
    expect(topChannelsByTime(map, 1).map((r) => r.key)).toEqual(["b"]);
  });

  it("returns [] for an undefined map", () => {
    expect(topChannelsByTime(undefined)).toEqual([]);
  });

  it("breaks ties by most-recently-watched", () => {
    const tie = {
      x: ch({ name: "X", lastWatched: "2025-01-01T00:00:00Z", secondsWatched: 50 }),
      y: ch({ name: "Y", lastWatched: "2025-02-01T00:00:00Z", secondsWatched: 50 }),
    };
    expect(topChannelsByTime(tie).map((r) => r.key)).toEqual(["y", "x"]);
  });
});

describe("mostEngagedChannels", () => {
  it("ranks by engaged count descending and drops zero-engaged channels", () => {
    const map = {
      a: ch({ name: "A", lastWatched: "x", engaged: 2 }),
      b: ch({ name: "B", lastWatched: "x", engaged: 9 }),
      c: ch({ name: "C", lastWatched: "x", engaged: 0, skipped: 4 }),
    };
    const ranked = mostEngagedChannels(map, 5);
    expect(ranked.map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("breaks equal engaged counts by higher engaged ratio", () => {
    const map = {
      // both 3 engaged, but A has a cleaner ratio (3/3 vs 3/6).
      a: ch({ name: "A", lastWatched: "x", engaged: 3 }),
      b: ch({ name: "B", lastWatched: "x", engaged: 3, skipped: 3 }),
    };
    expect(mostEngagedChannels(map).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("returns [] for an undefined map", () => {
    expect(mostEngagedChannels(undefined)).toEqual([]);
  });
});
