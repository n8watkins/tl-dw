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

/** chrome.storage.session key holding { [tabId]: prompt } for the handoff. */
export const PENDING_KEY = "pendingPrompts";

/** chrome.storage.session key holding the list of open destination tabs. */
export const OPEN_SEARCHES_KEY = "openSearches";

/** chrome.storage.session key holding recent auto-fill outcomes for the popup. */
export const DELIVERY_STATUS_KEY = "deliveryStatus";

/** chrome.storage.local key holding direct Gemini API usage stats. */
export const GEMINI_USAGE_KEY = "geminiUsage";

export const DEFAULT_SETTINGS: Settings = {
  autoSubmit: true,
  saveHistoryOnSearch: true,
  historyLimit: 100,
  autoExpireHistory: true,
  historyExpiryDays: 30,
  geminiUrl: GEMINI_URL,
  focusGeminiTab: true,
  autoPauseOnSummarize: false,
  worthWatchingGate: false,
  worthWatchingMinutes: 30,
  gateBypassTerms: "",
  includeTranscript: true,
  destinationId: "gemini",
  temporaryChats: true,
  autoTldwMinutes: 0,
  geminiApiKey: "",
};

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
