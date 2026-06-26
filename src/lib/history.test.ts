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

describe("computeChannelStats — grouping", () => {
  it("groups entries by channel and counts them", () => {
    const stats = computeChannelStats([
      channelEntry("a", "Chan"),
      channelEntry("b", "Chan"),
      channelEntry("c", "Other"),
    ]);
    const chan = stats.find((s) => s.channel === "Chan");
    expect(chan?.count).toBe(2);
    expect(chan?.videos).toHaveLength(2);
    expect(stats.find((s) => s.channel === "Other")?.count).toBe(1);
  });

  it("skips entries with no channel", () => {
    const stats = computeChannelStats([
      entry("x", daysAgo(0)),
      channelEntry("a", "Chan"),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].channel).toBe("Chan");
  });

  it("sorts channels by summary count descending", () => {
    const stats = computeChannelStats([
      channelEntry("a", "Few"),
      channelEntry("b", "Many"),
      channelEntry("c", "Many"),
      channelEntry("d", "Many"),
    ]);
    expect(stats.map((s) => s.channel)).toEqual(["Many", "Few"]);
  });
});
