import type {
  PromptProfile,
  SearchHistoryEntry,
  Settings,
  VideoContext,
} from "../types";
import { mutateHistory } from "./storage";

/** Keep only the newest `limit` entries ("unlimited" keeps all). Newest first. */
export function trimToLimit(
  entries: SearchHistoryEntry[],
  limit: Settings["historyLimit"],
): SearchHistoryEntry[] {
  if (limit === "unlimited") return entries;
  return entries.slice(0, limit);
}

/**
 * Drop entries older than the configured age when auto-expiry is on. Keeps
 * history from growing unbounded and quietly hitting the chrome.storage.local
 * quota. A no-op when the toggle is off.
 */
export function expireOldEntries(
  entries: SearchHistoryEntry[],
  settings: Settings,
): SearchHistoryEntry[] {
  if (!settings.autoExpireHistory) return entries;
  const cutoff = Date.now() - settings.historyExpiryDays * 24 * 60 * 60 * 1000;
  return entries.filter((e) => {
    const t = new Date(e.createdAt).getTime();
    // Keep entries with an unparseable date rather than silently dropping them.
    return Number.isNaN(t) || t >= cutoff;
  });
}

/** Prepend a new entry and trim to the configured limit. Newest first. */
export async function addHistoryEntry(args: {
  video: VideoContext;
  profile: PromptProfile;
  prompt: string;
  settings: Settings;
  destinationId?: string;
  aiRating?: number;
  channelAvatarUrl?: string;
  userRating?: "watch" | "skim" | "skip";
}): Promise<void> {
  const entry: SearchHistoryEntry = {
    id: crypto.randomUUID(),
    videoUrl: args.video.url,
    videoTitle: args.video.title,
    channel: args.video.channel,
    channelAvatarUrl: args.channelAvatarUrl,
    profileId: args.profile.id,
    profileName: args.profile.name,
    destinationId: args.destinationId,
    prompt: args.prompt,
    // De-duplicated: the raw response is NOT stored here. The single home for
    // full prompt + response is the Direct API call log (gated by the
    // keepFullCallLog setting); history keeps the prompt (needed for "ask
    // again") plus compact metadata only.
    aiRating: args.aiRating,
    userRating: args.userRating,
    createdAt: new Date().toISOString(),
  };
  // Serialized RMW (mutateHistory holds the history lock) so a concurrent
  // history edit can't clobber this new entry, or vice-versa.
  await mutateHistory((existing) => {
    const fresh = expireOldEntries([entry, ...existing], args.settings);
    return trimToLimit(fresh, args.settings.historyLimit);
  });
}

/** A real summary entry (has a non-empty prompt). */
export function isSummaryEntry(e: SearchHistoryEntry): boolean {
  return !!(e.prompt && e.prompt.trim());
}

export type ChannelStats = {
  channel: string;
  avatarUrl?: string;
  count: number;
  lastWatched: string;
  videos: SearchHistoryEntry[];
};

/** Group history by channel for the summary-centric Channels view. */
export function computeChannelStats(history: SearchHistoryEntry[]): ChannelStats[] {
  const byChannel = new Map<string, SearchHistoryEntry[]>();
  for (const entry of history) {
    if (!entry.channel) continue;
    const list = byChannel.get(entry.channel) ?? [];
    list.push(entry);
    byChannel.set(entry.channel, list);
  }
  return [...byChannel.entries()]
    .map(([channel, videos]) => ({
      channel,
      // Use the most recent entry's avatar (first in newest-first list).
      avatarUrl: videos[0]?.channelAvatarUrl,
      count: videos.length,
      lastWatched: videos[0]?.createdAt ?? "",
      videos,
    }))
    .sort((a, b) => b.count - a.count);
}
