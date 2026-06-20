import type { SearchHistoryEntry } from "../types";
import { localDateKey } from "./constants";
import { computeChannelStats, type ChannelStats } from "./history";

/**
 * Pure aggregation for the F7 Phase-1 dashboards (free, local week/month/year
 * views). No chrome.* / React — everything is derived from data already on disk:
 *   - history[]  — timestamped + rich (createdAt, channel, userRating, watched/
 *                  durationSeconds): the windowing engine.
 *   - activity   — daily summary COUNTS (Record<"YYYY-MM-DD", number>): the
 *                  pruning-proof source for the "summaries" count + active days.
 * Date math uses local-time Date components / localDateKey so windows line up
 * with the user's calendar (matching the streak/heatmap writers).
 */

export type WindowKind = "week" | "month" | "year";

/** Inclusive start, exclusive end — both at local midnight. */
export type DateRange = { start: Date; end: Date };

export type Engagement = { engaged: number; skimmed: number; skipped: number };

export type WindowStats = {
  range: DateRange;
  /** Summaries run in the window, from `activity` (survives history pruning). */
  summaries: number;
  /** History entries in the window (the denominator for the rich metrics). */
  videosWithMeta: number;
  /** Σ max(0, duration − watched) for skim/skip entries, seconds. */
  timeSavedSeconds: number;
  /** Σ durationSeconds of videos summarized in the window. */
  hoursPreviewedSeconds: number;
  engagement: Engagement;
  /** Channels active in the window, sorted by count desc (computeChannelStats). */
  topChannels: ChannelStats[];
  uniqueChannels: number;
  /** Distinct days in the window with ≥1 summary (from `activity`). */
  activeDays: number;
  /** Total days in the window (so the UI can say "5 of 7"). */
  totalDays: number;
};

export type WindowComparison = { current: WindowStats; previous: WindowStats };

export type Delta = { pct: number | null; dir: "up" | "down" | "flat" | "new" };

// --- date ranges (calendar-aware, local-time) -------------------------------

/** The current calendar window for `kind` containing `now` (local). Week starts
 *  Sunday to match the activity heatmap. */
export function rangeFor(kind: WindowKind, now: Date = new Date()): DateRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (kind === "week") start.setDate(start.getDate() - start.getDay());
  else if (kind === "month") start.setDate(1);
  else start.setMonth(0, 1); // year → Jan 1

  const end = new Date(start);
  if (kind === "week") end.setDate(end.getDate() + 7);
  else if (kind === "month") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);

  return { start, end };
}

/** The immediately-prior calendar window of the same kind (last week / last
 *  calendar month / last year) — NOT "N days ago". Its end is the current start. */
export function priorRange(range: DateRange, kind: WindowKind): DateRange {
  const start = new Date(range.start);
  if (kind === "week") start.setDate(start.getDate() - 7);
  else if (kind === "month") start.setMonth(start.getMonth() - 1);
  else start.setFullYear(start.getFullYear() - 1);
  return { start, end: new Date(range.start) };
}

function inRange(createdAt: string, range: DateRange): boolean {
  const t = new Date(createdAt).getTime();
  return !Number.isNaN(t) && t >= range.start.getTime() && t < range.end.getTime();
}

function daySpan(range: DateRange): number {
  return Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);
}

// --- aggregation ------------------------------------------------------------

export function windowStats(
  history: SearchHistoryEntry[],
  activity: Record<string, number>,
  range: DateRange,
): WindowStats {
  const inWindow = history.filter((e) => inRange(e.createdAt, range));

  const engagement: Engagement = { engaged: 0, skimmed: 0, skipped: 0 };
  let timeSavedSeconds = 0;
  let hoursPreviewedSeconds = 0;
  for (const e of inWindow) {
    if (e.userRating === "watch") engagement.engaged++;
    else if (e.userRating === "skim") engagement.skimmed++;
    else if (e.userRating === "skip") engagement.skipped++;
    if (e.durationSeconds != null) {
      hoursPreviewedSeconds += e.durationSeconds;
      if (e.userRating === "skim" || e.userRating === "skip") {
        timeSavedSeconds += Math.max(0, e.durationSeconds - (e.watchedSeconds ?? 0));
      }
    }
  }

  // summaries + active days from the daily-counts map over the window's days.
  let summaries = 0;
  let activeDays = 0;
  const cursor = new Date(range.start);
  while (cursor.getTime() < range.end.getTime()) {
    const c = activity[localDateKey(cursor)] ?? 0;
    summaries += c;
    if (c > 0) activeDays++;
    cursor.setDate(cursor.getDate() + 1);
  }

  const topChannels = computeChannelStats(inWindow);

  return {
    range,
    summaries,
    videosWithMeta: inWindow.length,
    timeSavedSeconds,
    hoursPreviewedSeconds,
    engagement,
    topChannels,
    uniqueChannels: topChannels.length,
    activeDays,
    totalDays: daySpan(range),
  };
}

export function compareWindows(
  history: SearchHistoryEntry[],
  activity: Record<string, number>,
  kind: WindowKind,
  now: Date = new Date(),
): WindowComparison {
  const range = rangeFor(kind, now);
  return {
    current: windowStats(history, activity, range),
    previous: windowStats(history, activity, priorRange(range, kind)),
  };
}

/** Percent change cur-vs-prev. `new` when there's no prior data to compare to,
 *  `flat` when both are zero or the change is negligible. */
export function pctDelta(cur: number, prev: number): Delta {
  if (prev === 0) return cur > 0 ? { pct: null, dir: "new" } : { pct: null, dir: "flat" };
  const pct = ((cur - prev) / prev) * 100;
  const dir = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  return { pct, dir };
}

// --- shared metric (moved here from StatsSection, was duplicated) ------------

/** Time saved = Σ max(0, duration − watched) over skim/skip entries, seconds. */
export function computeTimeSaved(history: SearchHistoryEntry[]): number {
  return history.reduce((acc, e) => {
    if ((e.userRating === "skim" || e.userRating === "skip") && e.durationSeconds != null) {
      return acc + Math.max(0, e.durationSeconds - (e.watchedSeconds ?? 0));
    }
    return acc;
  }, 0);
}
