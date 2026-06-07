import type {
  PromptProfile,
  SearchHistoryEntry,
  Settings,
  VideoContext,
} from "../types";
import { getHistory, setHistory } from "./storage";

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
  apiResponse?: string;
  aiRating?: number;
  audienceScore?: number;
  channelAvatarUrl?: string;
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
    apiResponse: args.apiResponse,
    aiRating: args.aiRating,
    audienceScore: args.audienceScore,
    createdAt: new Date().toISOString(),
  };
  const existing = await getHistory();
  const fresh = expireOldEntries([entry, ...existing], args.settings);
  const next = trimToLimit(fresh, args.settings.historyLimit);
  await setHistory(next);
}

export type ChannelStats = {
  channel: string;
  avatarUrl?: string;
  count: number;
  avgAiRating: number | null;
  avgAudienceScore: number | null;
  lastWatched: string;
  videos: SearchHistoryEntry[];
};

/** Group history by channel and compute per-channel averages. */
export function computeChannelStats(history: SearchHistoryEntry[]): ChannelStats[] {
  const byChannel = new Map<string, SearchHistoryEntry[]>();
  for (const entry of history) {
    if (!entry.channel) continue;
    const list = byChannel.get(entry.channel) ?? [];
    list.push(entry);
    byChannel.set(entry.channel, list);
  }
  return [...byChannel.entries()]
    .map(([channel, videos]) => {
      // history is newest-first; videos within a channel retain that ordering.
      const aiRatings = videos.map((v) => v.aiRating).filter((r): r is number => r !== undefined);
      const audScores = videos.map((v) => v.audienceScore).filter((s): s is number => s !== undefined);
      return {
        channel,
        // Use the most recent entry's avatar (first in newest-first list).
        avatarUrl: videos[0]?.channelAvatarUrl,
        count: videos.length,
        avgAiRating: aiRatings.length ? aiRatings.reduce((a, b) => a + b, 0) / aiRatings.length : null,
        avgAudienceScore: audScores.length ? audScores.reduce((a, b) => a + b, 0) / audScores.length : null,
        lastWatched: videos[0]?.createdAt ?? "",
        videos,
      };
    })
    .sort((a, b) => b.count - a.count);
}
