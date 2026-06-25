import type { ChannelStat } from "../types";
import { CHANNEL_STATS_CAP } from "./constants";

/**
 * Per-channel watch stats, derived from LifetimeStats.channels — the persisted,
 * never-pruned source of truth (vs computeChannelStats(history), which only
 * sees the retained history window). Pure helpers here power the Stats UI and
 * are unit-test-friendly.
 */

/** A channel aggregate with its key, for ranked UI lists. */
export type RankedChannel = ChannelStat & { key: string };

/**
 * Trim a channels map in place-safe (returns a new object) to the most-recently
 * watched `cap` channels, evicting the oldest by `lastWatched`. Mirrors how
 * `trimActivity` bounds the activity map. Entries with an unparseable/empty
 * `lastWatched` sort oldest so they're evicted first.
 *
 * Pure helper exported for tests and for the storage writer.
 */
export function trimChannelStats(
  channels: Record<string, ChannelStat>,
  cap: number = CHANNEL_STATS_CAP,
): Record<string, ChannelStat> {
  const keys = Object.keys(channels);
  if (keys.length <= cap) return channels;
  const ts = (k: string): number => {
    const t = new Date(channels[k]!.lastWatched).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const keep = new Set(
    keys.sort((a, b) => ts(b) - ts(a)).slice(0, cap),
  );
  const trimmed: Record<string, ChannelStat> = {};
  for (const k of keep) trimmed[k] = channels[k]!;
  return trimmed;
}

/** Total rated verdicts for a channel (engaged + skimmed + skipped). */
function ratedCount(c: ChannelStat): number {
  return c.engaged + c.skimmed + c.skipped;
}

/** Engaged ratio (0..1) for a channel, or null when nothing's rated yet. */
export function engagedRatio(c: ChannelStat): number | null {
  const rated = ratedCount(c);
  return rated > 0 ? c.engaged / rated : null;
}

/** Flatten a channels map into an array carrying each channel's key. */
function toList(channels: Record<string, ChannelStat> | undefined): RankedChannel[] {
  if (!channels) return [];
  return Object.entries(channels).map(([key, c]) => ({ key, ...c }));
}

/**
 * Top channels by time spent (descending `secondsWatched`). Channels with zero
 * watch time are dropped — they carry no "time spent" signal. Ties break by
 * most-recently watched so the list is stable and meaningful.
 */
export function topChannelsByTime(
  channels: Record<string, ChannelStat> | undefined,
  limit = 5,
): RankedChannel[] {
  return toList(channels)
    .filter((c) => c.secondsWatched > 0)
    .sort(
      (a, b) =>
        b.secondsWatched - a.secondsWatched ||
        b.lastWatched.localeCompare(a.lastWatched),
    )
    .slice(0, limit);
}

/**
 * Most-engaged channels: ranked by engaged COUNT (the user ask is "which
 * channels the user is MOST ENGAGED with"). A high raw engaged count means the
 * user actually watches that channel's videos through; ratio alone would float
 * a one-video channel above a 50-video favourite. Ties break by engaged ratio,
 * then recency. Channels with zero engaged videos are dropped.
 */
export function mostEngagedChannels(
  channels: Record<string, ChannelStat> | undefined,
  limit = 5,
): RankedChannel[] {
  return toList(channels)
    .filter((c) => c.engaged > 0)
    .sort((a, b) => {
      if (b.engaged !== a.engaged) return b.engaged - a.engaged;
      const ra = engagedRatio(a) ?? 0;
      const rb = engagedRatio(b) ?? 0;
      if (rb !== ra) return rb - ra;
      return b.lastWatched.localeCompare(a.lastWatched);
    })
    .slice(0, limit);
}
