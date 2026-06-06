import type { Destination, Settings } from "../types";

export const GEMINI_URL = "https://gemini.google.com/app";

/**
 * Where summaries can be sent. Each destination is auto-filled by its content
 * script (the injector types the prompt into the site's composer); only Gemini
 * can watch the YouTube URL itself, so the rest get the transcript included.
 */
export const DESTINATIONS: Destination[] = [
  { id: "gemini", label: "Gemini", url: GEMINI_URL, canWatch: true },
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", label: "Claude", url: "https://claude.ai/new" },
  {
    id: "notebooklm",
    label: "NotebookLM",
    url: "https://notebooklm.google.com/",
    // NotebookLM is a sources tool, not a chat box. Currently in link mode: the
    // injector drives its "Websites" source with the YouTube URL. Switch to
    // "source" to paste the transcript via "Copied text" instead.
    payload: "link",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    url: "https://www.perplexity.ai/",
  },
];

export function getDestination(id: string | undefined): Destination {
  return DESTINATIONS.find((d) => d.id === id) ?? DESTINATIONS[0];
}

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

export const DEFAULT_SETTINGS: Settings = {
  autoSubmit: true,
  saveHistoryOnSearch: true,
  historyLimit: 100,
  geminiUrl: GEMINI_URL,
  focusGeminiTab: true,
  autoPauseOnSummarize: false,
  worthWatchingGate: false,
  worthWatchingMinutes: 30,
  gateBypassTerms: "",
  includeTranscript: true,
  destinationId: "gemini",
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
