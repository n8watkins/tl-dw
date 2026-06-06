import type { Destination, Settings } from "../types";

export const GEMINI_URL = "https://gemini.google.com/app";

/**
 * Where summaries can be sent. Gemini is auto-filled by its content script;
 * the rest can't be reliably auto-filled (different DOM, and they can't watch
 * a YouTube URL), so they use the clipboard hand-off and rely on the
 * transcript being included.
 */
export const DESTINATIONS: Destination[] = [
  { id: "gemini", label: "Gemini", url: GEMINI_URL, mode: "inject", canWatch: true },
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/", mode: "inject" },
  { id: "claude", label: "Claude", url: "https://claude.ai/new", mode: "inject" },
  {
    id: "notebooklm",
    label: "NotebookLM",
    url: "https://notebooklm.google.com/",
    mode: "inject",
    // NotebookLM is a sources tool, not a chat box. Currently in link mode: the
    // injector drives its "Websites" source with the YouTube URL. Switch to
    // "source" to paste the transcript via "Copied text" instead.
    payload: "link",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    url: "https://www.perplexity.ai/",
    mode: "inject",
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

export const DEFAULT_SETTINGS: Settings = {
  autoSubmit: true,
  saveHistoryOnSearch: true,
  historyLimit: 100,
  geminiUrl: GEMINI_URL,
  focusGeminiTab: true,
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
