import type {
  Destination,
  HistoryExpiryDays,
  Settings,
} from "../types";

export const GEMINI_URL = "https://gemini.google.com/app";
export const GEMINI_QUOTA_TIME_ZONE = "America/Los_Angeles";
export const AI_STUDIO_LINKS = {
  usage: "https://aistudio.google.com/usage",
  apiKeys: "https://aistudio.google.com/apikey",
  rateLimits: "https://aistudio.google.com/rate-limit",
  rateLimitDocs: "https://aistudio.google.com/docs/rate-limits",
  pricing: "https://aistudio.google.com/docs/pricing",
  terms: "https://aistudio.google.com/docs/terms",
  billing: "https://console.cloud.google.com/billing",
  budgets: "https://console.cloud.google.com/billing/budgets",
} as const;

/**
 * The Gemini API models TL;DW offers. Model codes as listed on
 * aistudio.google.com/docs/models (checked 2026-11-02). The default is the
 * cheapest fast model; when Google answers 429 (rate or quota limit) for it,
 * TL;DW retries once on the fallback.
 */
export const DEFAULT_GEMINI_MODEL_ID = "gemini-3.5-flash-lite";
export const FALLBACK_GEMINI_MODEL_ID = "gemini-3.1-flash-lite";

export type GeminiModelOption = { id: string; label: string; note: string };

export const GEMINI_MODELS: GeminiModelOption[] = [
  {
    id: DEFAULT_GEMINI_MODEL_ID,
    label: "Gemini 3.5 Flash-Lite",
    note: "Recommended. Fast and the cheapest; works on the free tier.",
  },
  {
    id: FALLBACK_GEMINI_MODEL_ID,
    label: "Gemini 3.1 Flash-Lite",
    note: "The previous Flash-Lite. TL;DW switches to it automatically when 3.5 Flash-Lite hits a limit.",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    note: "More thorough summaries. Costs more per summary and usually has lower free-tier limits.",
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    note: "Google's newest Flash model. Costs more per summary and usually has lower free-tier limits.",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (preview)",
    note: "The most capable and the slowest. Best with billing enabled; free-tier limits are low or none.",
  },
];

/** The saved model when TL;DW still offers it, otherwise the default. */
export function resolveGeminiModelId(id: string | undefined): string {
  return GEMINI_MODELS.some((m) => m.id === id) ? id! : DEFAULT_GEMINI_MODEL_ID;
}

/** A model's display name ("Gemini 3.5 Flash-Lite"), or its code when unknown. */
export function geminiModelLabel(id: string | undefined): string {
  return GEMINI_MODELS.find((m) => m.id === id)?.label ?? id ?? GEMINI_MODELS[0].label;
}

/**
 * Prompt size limits. The Gemini web app kept only the first ~32,000 characters
 * of a 175,000-character prompt when signed out (2026-11-02), so a prompt for
 * the Gemini tab stays under that limit. The Gemini API takes far more (a
 * million-token context).
 */
export const GEMINI_WEB_MAX_PROMPT_CHARS = 30_000;
export const DIRECT_API_MAX_PROMPT_CHARS = 1_000_000;

/**
 * TL;DW works with Gemini only (owner decision, 2026-11-09; see
 * docs/DECISIONS.md): the Gemini API with the user's own key, or the Gemini web
 * app in a tab without one.
 */
export const GEMINI_DESTINATION: Destination = {
  id: "gemini",
  label: "Gemini",
  url: GEMINI_URL,
  canWatch: true,
  maxPromptChars: GEMINI_WEB_MAX_PROMPT_CHARS,
  // Gemini's temporary chat has no URL parameter: the injector clicks its button.
};

/**
 * Names of the chat sites TL;DW sent to before it became Gemini-only, so
 * History and Stats still name where an older summary went.
 */
const RETIRED_DESTINATION_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  notebooklm: "NotebookLM",
};

/** Where a summary went, by the id History recorded ("Gemini" for none). */
export function destinationLabel(id: string | undefined): string {
  return (id && RETIRED_DESTINATION_LABELS[id]) || GEMINI_DESTINATION.label;
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

/** chrome.storage.local key holding the Direct API model fallback state. */
export const MODEL_FALLBACK_KEY = "tldwModelFallback";

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
  geminiModelId: DEFAULT_GEMINI_MODEL_ID,
  useDirectApi: false,
  // Opt-in: it sends each watched video's ID to the SponsorBlock API.
  skipSponsors: false,
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

function youtubeHost(u: URL): boolean {
  const host = u.hostname.replace(/^www\./, "");
  return host === "youtube.com" || host === "m.youtube.com";
}

/**
 * Extract the video ID from a YouTube watch URL (or a youtu.be share link).
 * Returns null for everything else, Shorts included: TL;DW does not run on
 * Shorts at all (they have no transcript panel to read).
 */
export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (youtubeHost(u)) {
      return u.pathname === "/watch" ? u.searchParams.get("v") || null : null;
    }
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
  } catch {
    // fall through
  }
  return null;
}

/** True for a YouTube watch page with a video id: the only page TL;DW acts on. */
export function isYouTubeVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return youtubeHost(u) && u.pathname === "/watch" && !!u.searchParams.get("v");
  } catch {
    return false;
  }
}

/** True only for YouTube Shorts URLs, where TL;DW is deliberately unavailable. */
export function isYouTubeShortUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return youtubeHost(u) && u.pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

/**
 * Shown instead of a summary when TL;DW couldn't read the video's transcript.
 * It never sends a prompt that could only be answered from the title.
 */
export const NO_TRANSCRIPT_MESSAGE =
  "No transcript available for this video, so TL;DW didn't summarize it: a summary from the title alone would be guesswork. " +
  "YouTube may have no captions for it, or couldn't load them just now.";
