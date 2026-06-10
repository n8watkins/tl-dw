import type {
  Destination,
  HistoryExpiryDays,
  Settings,
  WatchThresholdMinutes,
} from "../types";

export const GEMINI_URL = "https://gemini.google.com/app";

/**
 * Where summaries can be sent. Each destination is auto-filled by its content
 * script (the injector types the prompt into the site's composer); only Gemini
 * can watch the YouTube URL itself, so the rest get the transcript included.
 */
export const DESTINATIONS: Destination[] = [
  {
    id: "gemini",
    label: "Gemini",
    url: GEMINI_URL,
    canWatch: true,
    // Gemini temporary chat has no URL param — content script clicks the button.
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    incognitoUrl: "https://chatgpt.com/?temporary-chat=true",
  },
  {
    id: "claude",
    label: "Claude",
    url: "https://claude.ai/new",
    incognitoUrl: "https://claude.ai/new?incognito=true",
  },
  {
    id: "notebooklm",
    label: "NotebookLM",
    url: "https://notebooklm.google.com/",
    // NotebookLM is a sources tool, not a chat box. Currently in link mode: the
    // injector drives its "Websites" source with the YouTube URL. Switch to
    // "source" to paste the transcript via "Copied text" instead.
    payload: "link",
    // NotebookLM has no temporary/incognito mode.
  },
];

export function getDestination(id: string | undefined): Destination {
  return DESTINATIONS.find((d) => d.id === id) ?? DESTINATIONS[0];
}

/**
 * The call-to-action verb for a destination. Source/link tools (NotebookLM)
 * ingest material rather than answer a prompt, so "Add to" reads right; chat
 * destinations get "Ask".
 */
export function destinationVerb(dest: Destination): string {
  return dest.payload === "source" || dest.payload === "link" ? "Add to" : "Ask";
}

/** The length thresholds the worth-watching gate offers (single source of truth). */
export const WATCH_THRESHOLD_OPTIONS: WatchThresholdMinutes[] = [15, 20, 30, 45, 60];

/** The ages the history auto-expiry offers (single source of truth). */
export const HISTORY_EXPIRY_OPTIONS: HistoryExpiryDays[] = [7, 30, 90, 365];

export const STORAGE_KEYS = {
  profiles: "profiles",
  history: "history",
  settings: "settings",
} as const;

/** chrome.storage.local key for the summary result cache (Record<videoId, CachedSummary>). */
export const SUMMARY_CACHE_KEY = "tldwSummaryCache";

/** How long a cached summary is considered fresh. Video content doesn't change, so 7 days is generous. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard cap on cached summaries (in addition to the TTL) so a binge-watcher
 *  can't accumulate unbounded entries toward the ~10 MB storage quota. */
export const CACHE_MAX_ENTRIES = 300;

/**
 * Prune a `{ [id]: { cachedAt } }` cache in place: drop TTL-expired entries,
 * then keep only the `CACHE_MAX_ENTRIES` most-recently-cached. Used by every
 * cache writer (background and content script) so growth is bounded one way.
 */
export function pruneCache<T extends { cachedAt: string }>(
  cache: Record<string, T>,
  now: number = Date.now(),
): Record<string, T> {
  for (const id of Object.keys(cache)) {
    if (now - new Date(cache[id]!.cachedAt).getTime() > CACHE_TTL_MS) delete cache[id];
  }
  const ids = Object.keys(cache);
  if (ids.length > CACHE_MAX_ENTRIES) {
    ids
      .sort((a, b) => new Date(cache[b]!.cachedAt).getTime() - new Date(cache[a]!.cachedAt).getTime())
      .slice(CACHE_MAX_ENTRIES)
      .forEach((id) => delete cache[id]);
  }
  return cache;
}

/** chrome.storage.session key holding { [tabId]: prompt } for the handoff. */
export const PENDING_KEY = "pendingPrompts";

/** chrome.storage.session key holding the list of open destination tabs. */
export const OPEN_SEARCHES_KEY = "openSearches";

/** chrome.storage.session key holding recent auto-fill outcomes for the popup. */
export const DELIVERY_STATUS_KEY = "deliveryStatus";

/** chrome.storage.local key holding direct Gemini API usage stats. */
export const GEMINI_USAGE_KEY = "geminiUsage";

/** chrome.storage.local key holding the list of auto-run channels (AutoRunChannel[]). */
export const AUTO_RUN_CHANNELS_KEY = "autoRunChannels";

/** chrome.storage.local key holding the list of blocked channels (BlockedChannel[]). */
export const BLOCKED_CHANNELS_KEY = "tldwBlockedChannels";

/** chrome.storage.local key holding per-call Direct API history entries. */
export const GEMINI_CALL_LOG_KEY = "geminiCallLog";

export const DEFAULT_SETTINGS: Settings = {
  autoSubmit: true,
  saveHistoryOnSearch: true,
  historyLimit: 100,
  autoExpireHistory: true,
  historyExpiryDays: 30,
  focusGeminiTab: true,
  autoPauseOnSummarize: false,
  worthWatchingGate: false,
  worthWatchingMinutes: 30,
  gateBypassTerms: "",
  destinationId: "gemini",
  temporaryChats: true,
  autoTldwMinutes: 0,
  geminiApiKey: "",
  geminiApiKeyName: "",
  useDirectApi: false,
  showAiRecommendation: true,
  trackAiAverage: true,
  trackEngagement: true,
  showEngagementStatus: true,
  engagedPct: 60,
  skimmedPct: 15,
  trackMyAverage: true,
  skipSponsors: true,
  keepFullCallLog: false,
};

/**
 * Display labels for the personal verdict. The internal enum stays
 * watch/skim/skip everywhere; only what the user sees changes.
 */
export const USER_RATING_LABELS: Record<"watch" | "skim" | "skip", string> = {
  watch: "Engaged",
  skim: "Skimmed",
  skip: "Skipped",
};

/** Numeric scale for averaging the personal verdict across a channel's videos. */
export const USER_RATING_SCALE: Record<"watch" | "skim" | "skip", number> = {
  watch: 3,
  skim: 2,
  skip: 1,
};

/**
 * Map a 1–10 quality/audience score to the WATCH/SKIM/SKIP verdict vocabulary.
 * Shared by the content panel and the Channels view so both speak in words, not
 * numbers (≤3 SKIP, ≤6 SKIM, else WATCH).
 */
export function scoreToVerdict(score: number): string {
  if (score <= 3) return "SKIP";
  if (score <= 6) return "SKIM";
  return "WATCH";
}

/**
 * Map an averaged personal verdict (USER_RATING_SCALE, 1–3) to the nearest
 * bucket label: ≥2.5 → Engaged, ≥1.5 → Skimmed, else Skipped.
 */
export function userAvgToLabel(avg: number): string {
  if (avg >= 2.5) return USER_RATING_LABELS.watch;
  if (avg >= 1.5) return USER_RATING_LABELS.skim;
  return USER_RATING_LABELS.skip;
}

/**
 * Extract the YouTube video ID from any watch/shorts/youtu.be URL.
 * Returns null for non-video URLs or URLs that don't parse.
 */
export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const shorts = /^\/shorts\/([^/?]+)/.exec(u.pathname);
      if (shorts) return shorts[1];
    }
    if (host === "youtu.be") return u.pathname.slice(1) || null;
  } catch {
    // fall through
  }
  return null;
}

export function isYouTubeVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com") return false;
    return u.pathname === "/watch" || u.pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

/** True only for YouTube Shorts URLs — Shorts have no transcript. */
export function isYouTubeShortUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "m.youtube.com") return false;
    return u.pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}
