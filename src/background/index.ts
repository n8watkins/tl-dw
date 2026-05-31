import { buildPrompt } from "../lib/promptBuilder";
import { isYouTubeVideoUrl } from "../lib/constants";
import { addHistoryEntry } from "../lib/history";
import {
  ensureSeeded,
  getSettings,
  resolveProfile,
  setPendingPrompt,
  takePendingPrompt,
} from "../lib/storage";
import type { RuntimeMessage, VideoContext } from "../types";

chrome.runtime.onInstalled.addListener(() => {
  void ensureSeeded();
});

/** Clean YouTube's tab title: drop unread "(3) " prefix and " - YouTube". */
function cleanTitle(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*-\s*YouTube\s*$/, "")
    .trim();
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab;
}

/** Briefly flash the toolbar badge to signal "not a YouTube video". */
async function flashBadge(text: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 2500);
}

/**
 * The core motion: read the active YouTube tab, build the prompt from the
 * chosen (or default) profile, open a fresh Gemini tab, and stash the prompt
 * for that tab's content script to inject + submit.
 */
async function askGemini(profileId?: string): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.url || !isYouTubeVideoUrl(tab.url)) {
    await flashBadge("!");
    return;
  }

  const profile = await resolveProfile(profileId);
  if (!profile) return;

  const settings = await getSettings();
  const video: VideoContext = {
    url: tab.url,
    title: cleanTitle(tab.title),
  };
  const { prompt } = buildPrompt(profile, video);

  const geminiTab = await chrome.tabs.create({ url: settings.geminiUrl });
  if (geminiTab.id !== undefined) {
    await setPendingPrompt(geminiTab.id, prompt);
  }

  if (settings.saveHistoryOnSearch) {
    await addHistoryEntry({ video, profile, prompt, settings });
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "ask-gemini") void askGemini();
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "ASK") {
      void askGemini(message.profileId).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "GET_PENDING") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({ prompt: null });
        return true;
      }
      void Promise.all([takePendingPrompt(tabId), getSettings()]).then(
        ([prompt, settings]) =>
          sendResponse({
            prompt: prompt ?? null,
            autoSubmit: settings.autoSubmit,
          }),
      );
      return true;
    }
    return false;
  },
);
