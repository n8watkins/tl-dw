import type { Settings } from "../types";

export const GEMINI_URL = "https://gemini.google.com/app";

export const STORAGE_KEYS = {
  profiles: "profiles",
  history: "history",
  settings: "settings",
} as const;

/** chrome.storage.session key holding { [tabId]: prompt } for the handoff. */
export const PENDING_KEY = "pendingPrompts";

export const DEFAULT_SETTINGS: Settings = {
  autoSubmit: true,
  saveHistoryOnSearch: true,
  historyLimit: 100,
  geminiUrl: GEMINI_URL,
  focusGeminiTab: true,
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
