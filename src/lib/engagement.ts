/**
 * Pure verdict logic for the automatic engagement tracking system.
 * Kept in lib/ so it can be unit-tested without a browser environment.
 */

export type EngagementVerdict = "watch" | "skim" | "skip" | null;

/**
 * Numeric rank for the upgrade-only rule:
 *   null → 0 (no verdict yet)
 *   "skip" → 1
 *   "skim" → 2
 *   "watch" → 3
 * A stored verdict is replaced only when the new rank is strictly higher.
 */
export const VERDICT_RANK: Record<string, number> & { null: number } = {
  null: 0,
  skip: 1,
  skim: 2,
  watch: 3,
};

/**
 * Compute the engagement verdict for a video based on how much the user watched.
 *
 * Rules:
 * - duration <= 0 or NaN → null (can't determine anything)
 * - pct = watchedSeconds / durationSeconds * 100
 * - "watch": pct >= engagedPct OR watchedSeconds >= 1200 (20-min absolute cap)
 * - "skim": pct >= skimmedPct
 * - "skip": pct < skimmedPct AND (sawSummary OR watchedSeconds >= 5)
 * - null: pct < skimmedPct AND !sawSummary AND watchedSeconds < 5
 *         (stray visit with no meaningful signal — record nothing)
 */
export function computeEngagementVerdict(
  watchedSeconds: number,
  durationSeconds: number,
  opts: { engagedPct: number; skimmedPct: number; sawSummary: boolean },
): EngagementVerdict {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  const pct = (watchedSeconds / durationSeconds) * 100;

  if (pct >= opts.engagedPct || watchedSeconds >= 1200) {
    return "watch";
  }
  if (pct >= opts.skimmedPct) {
    return "skim";
  }
  // Below skim floor — only record if the user had some meaningful interaction
  if (opts.sawSummary || watchedSeconds >= 5) {
    return "skip";
  }
  return null;
}
