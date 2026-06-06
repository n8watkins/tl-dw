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
  const next = trim([entry, ...existing], args.settings.historyLimit);
  await setHistory(next);
}
