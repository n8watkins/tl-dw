import type {
  Destination,
  HistoryExpiryDays,
  Settings,
} from "../types";

export const GEMINI_URL = "https://gemini.google.com/app";
export const GEMINI_MODEL_ID = "gemini-3.1-flash-lite";
export const GEMINI_FREE_TIER_RPD = 500;
export const GEMINI_QUOTA_TIME_ZONE = "America/Los_Angeles";
export const GEMINI_RECOMMENDATION_DATE = "July 2026";
export const AI_STUDIO_LINKS = {
  usage: "https://aistudio.google.com/usage",
  apiKeys: "https://aistudio.google.com/apikey",
  billing: "https://console.cloud.google.com/billing",
  budgets: "https://console.cloud.google.com/billing/budgets",
} as const;

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
 *  can't accumulate unbounded entries toward the ~5 MB storage quota. */
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

/** chrome.storage.local key holding per-call Direct API history entries. */
export const GEMINI_CALL_LOG_KEY = "geminiCallLog";

/** chrome.storage.local key for lifetime usage stats (never pruned). */
export const TLDW_STATS_KEY = "tldwStats";

/** chrome.storage.local key for the user's tag library (Tag[]). */
export const TAGS_KEY = "tldwTags";
/** chrome.storage.local key mapping channel key -> tag ids (Record<string, string[]>).
 *  Channel tags auto-apply to every video from that channel. The channel key is
 *  the same one used for auto-run/blocked lookups (getChannelInfo().id, else name). */
export const CHANNEL_TAGS_KEY = "tldwChannelTags";
/** chrome.storage.local key mapping videoId -> tag ids (Record<string, string[]>).
 *  Video tags are one-off; "apply to all future" promotes them into CHANNEL_TAGS_KEY. */
export const VIDEO_TAGS_KEY = "tldwVideoTags";

export const DEFAULT_SETTINGS: Settings = {
  autoSubmit: true,
  saveHistoryOnSearch: true,
  historyLimit: 100,
  autoExpireHistory: true,
  historyExpiryDays: 30,
  focusGeminiTab: true,
  autoPauseOnSummarize: false,
  destinationId: "gemini",
  temporaryChats: true,
  autoTldwMinutes: 0,
  geminiApiKey: "",
  geminiApiKeyName: "",
  geminiKeyValidation: { status: "unverified" },
  useDirectApi: false,
  skipSponsors: true,
  keepFullCallLog: false,
  firstRunNoticeSeen: false,
};

/**
 * Local-timezone "YYYY-MM-DD" key. The activity heatmap and the daily Gemini
 * quota counter are presented as "today" (the user's calendar day), so the day
 * key must be derived from local components on BOTH the write and read side.
 * `Date.toISOString().slice(0,10)` slices the UTC date, which drifts a day for
 * negative-UTC zones (all of the Americas) once the UTC day has rolled over —
 * making a streak read as broken or the quota reset mid-afternoon. Use this on
 * both sides so they always agree.
 */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
