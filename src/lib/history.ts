import type {
  PromptProfile,
  SearchHistoryEntry,
  Settings,
  VideoContext,
} from "../types";
import { getHistory, setHistory } from "./storage";

function trim(
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
}): Promise<void> {
  const entry: SearchHistoryEntry = {
    id: crypto.randomUUID(),
    videoUrl: args.video.url,
    videoTitle: args.video.title,
    profileId: args.profile.id,
    profileName: args.profile.name,
    destinationId: args.destinationId,
    prompt: args.prompt,
    createdAt: new Date().toISOString(),
  };
  const existing = await getHistory();
  const fresh = expireOldEntries([entry, ...existing], args.settings);
  const next = trim(fresh, args.settings.historyLimit);
  await setHistory(next);
}
