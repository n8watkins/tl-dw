import { describe, expect, it } from "vitest";
import { computeChannelStats, expireOldEntries, trimToLimit } from "./history";
import { DEFAULT_SETTINGS } from "./constants";
import type { SearchHistoryEntry, Settings } from "../types";

function entry(id: string, createdAt: string): SearchHistoryEntry {
  return {
    id,
    videoUrl: `https://youtube.com/watch?v=${id}`,
    profileId: "tldw",
    profileName: "TL;DW",
    prompt: "prompt",
    createdAt,
  };
}

function channelEntry(
  id: string,
  channel: string,
  userRating?: "watch" | "skim" | "skip",
): SearchHistoryEntry {
  return { ...entry(id, daysAgo(0)), channel, userRating };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("trimToLimit", () => {
  // Newest first, e0 … e59.
  const many = Array.from({ length: 60 }, (_, i) => entry(`e${i}`, daysAgo(i)));

  it("keeps only the newest N entries", () => {
    const result = trimToLimit(many, 50);
    expect(result).toHaveLength(50);
    expect(result[0].id).toBe("e0");
    expect(result[49].id).toBe("e49");
  });

  it("keeps everything when under the limit", () => {
    expect(trimToLimit(many, 100)).toHaveLength(60);
  });

  it("keeps everything when unlimited", () => {
    expect(trimToLimit(many, "unlimited")).toHaveLength(60);
  });
});

describe("expireOldEntries", () => {
  it("is a no-op when auto-expiry is off", () => {
    const list = [entry("a", daysAgo(0)), entry("b", daysAgo(400))];
    const result = expireOldEntries(list, settings({ autoExpireHistory: false }));
    expect(result).toHaveLength(2);
  });

  it("drops entries older than the configured age", () => {
    const list = [entry("fresh", daysAgo(5)), entry("stale", daysAgo(40))];
    const result = expireOldEntries(
      list,
      settings({ autoExpireHistory: true, historyExpiryDays: 30 }),
    );
    expect(result.map((e) => e.id)).toEqual(["fresh"]);
  });

  it("keeps entries exactly at the cutoff boundary", () => {
    // 30 days minus a minute should still be inside the window.
    const list = [entry("edge", daysAgo(30 - 1 / 1440))];
    const result = expireOldEntries(
      list,
      settings({ autoExpireHistory: true, historyExpiryDays: 30 }),
    );
    expect(result).toHaveLength(1);
  });

  it("keeps entries with an unparseable date rather than dropping them", () => {
    const list = [entry("bad", "not-a-date"), entry("stale", daysAgo(99))];
    const result = expireOldEntries(
      list,
      settings({ autoExpireHistory: true, historyExpiryDays: 30 }),
    );
    expect(result.map((e) => e.id)).toEqual(["bad"]);
  });
});

describe("computeChannelStats — user rating", () => {
  it("averages userRating through the watch=3/skim=2/skip=1 scale", () => {
    // one watch (3) + one skim (2) ⇒ 2.5
    const stats = computeChannelStats([
      channelEntry("a", "Chan", "watch"),
      channelEntry("b", "Chan", "skim"),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].avgUserRating).toBe(2.5);
  });

  it("tallies userBreakdown counts per channel", () => {
    const stats = computeChannelStats([
      channelEntry("a", "Chan", "watch"),
      channelEntry("b", "Chan", "watch"),
      channelEntry("c", "Chan", "skim"),
      channelEntry("d", "Chan", "skip"),
    ]);
    expect(stats[0].userBreakdown).toEqual({ engaged: 2, skimmed: 1, skipped: 1 });
  });

  it("ignores unrated entries when averaging", () => {
    // watch (3) + skip (1) rated, one unrated ⇒ avg 2; breakdown counts only rated
    const stats = computeChannelStats([
      channelEntry("a", "Chan", "watch"),
      channelEntry("b", "Chan", "skip"),
      channelEntry("c", "Chan"),
    ]);
    expect(stats[0].avgUserRating).toBe(2);
    expect(stats[0].userBreakdown).toEqual({ engaged: 1, skimmed: 0, skipped: 1 });
  });

  it("returns null avgUserRating when no entries are rated", () => {
    const stats = computeChannelStats([
      channelEntry("a", "Chan"),
      channelEntry("b", "Chan"),
    ]);
    expect(stats[0].avgUserRating).toBeNull();
    expect(stats[0].userBreakdown).toEqual({ engaged: 0, skimmed: 0, skipped: 0 });
  });
});
