import { buildPrompt } from "../lib/promptBuilder";
import { isYouTubeVideoUrl } from "../lib/constants";
import { addHistoryEntry } from "../lib/history";
import {
  ensureSeeded,
  getProfiles,
  getSettings,
  resolveProfile,
  setPendingPrompt,
  takePendingPrompt,
} from "../lib/storage";
import type { RuntimeMessage, VideoContext } from "../types";

const MENU_ROOT = "tldw-root";

/**
 * Where the menu is offered: the toolbar icon ("action"), a right-click
 * anywhere on a YouTube page ("page"), and a right-click on a video link such
 * as a suggested-video thumbnail ("link"). The page/link entries are scoped to
 * youtube.com so they don't clutter right-clicks elsewhere.
 */
const MENU_CONTEXTS: chrome.contextMenus.ContextType[] = [
  "action",
  "page",
  "link",
];
const YOUTUBE_DOC_PATTERNS = ["*://*.youtube.com/*"];

/** Rebuild the right-click menu to reflect the current profiles. */
async function rebuildContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();

  const profiles = await getProfiles();
  if (profiles.length === 0) return;

  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: "Ask Gemini with...",
    contexts: MENU_CONTEXTS,
    documentUrlPatterns: YOUTUBE_DOC_PATTERNS,
  });

  for (const profile of profiles) {
    chrome.contextMenus.create({
      id: profile.id,
      parentId: MENU_ROOT,
      title: profile.name,
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: YOUTUBE_DOC_PATTERNS,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSeeded().then(() => rebuildContextMenu());
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ROOT) {
    // info.linkUrl is set when the click landed on a link (e.g. a thumbnail).
    void askGemini(info.menuItemId as string, info.linkUrl);
  }
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

/**
 * Ask the watch page's content script for the transcript. Returns null if the
 * tab has no content script (page predates install), the video has no
 * captions, or anything else goes wrong — the caller proceeds without it.
 */
async function requestTranscript(tabId: number): Promise<string | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "GET_TRANSCRIPT",
    })) as { transcript: string | null } | undefined;
    return res?.transcript ?? null;
  } catch {
    return null;
  }
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
async function askGemini(profileId?: string, linkUrl?: string): Promise<void> {
  // A right-clicked video link (a thumbnail) wins over the active tab, so a
  // suggested video gets summarized rather than the page you're sitting on.
  // Everything else — page right-click, toolbar icon, keyboard shortcut —
  // falls back to the active tab.
  let url: string | undefined;
  let title: string | undefined;
  // The tab whose content script can hand us a transcript — only the loaded
  // watch page, so a thumbnail (a different video) leaves this undefined.
  let transcriptTabId: number | undefined;
  if (linkUrl && isYouTubeVideoUrl(linkUrl)) {
    url = linkUrl;
  } else {
    const tab = await getActiveTab();
    url = tab?.url;
    title = cleanTitle(tab?.title);
    if (tab?.id !== undefined && url && isYouTubeVideoUrl(url)) {
      transcriptTabId = tab.id;
    }
  }

  if (!url || !isYouTubeVideoUrl(url)) {
    await flashBadge("!");
    return;
  }

  const profile = await resolveProfile(profileId);
  if (!profile) return;

  const settings = await getSettings();
  const video: VideoContext = { url, title };

  // The transcript is large, so it's appended to the sent prompt but kept out
  // of the version logged to history. Profiles that place {{transcript}}
  // themselves get it inline instead of appended.
  const transcript =
    settings.includeTranscript && transcriptTabId !== undefined
      ? await requestTranscript(transcriptTabId)
      : null;
  const placesTranscript = /\{\{\s*transcript\s*\}\}/.test(profile.promptTemplate);
  const { prompt } = buildPrompt(
    profile,
    video,
    undefined,
    transcript ? { transcript } : {},
  );
  const sentPrompt =
    transcript && !placesTranscript
      ? `${prompt}\n\n---\nVideo transcript (verbatim, for reference):\n${transcript}`
      : prompt;

  const geminiTab = await chrome.tabs.create({
    url: settings.geminiUrl,
    active: settings.focusGeminiTab,
  });
  if (geminiTab.id !== undefined) {
    await setPendingPrompt(geminiTab.id, sentPrompt);
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
    if (message.type === "REBUILD_MENU") {
      void rebuildContextMenu().then(() => sendResponse({ ok: true }));
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
