import { buildDestinationPrompt } from "../lib/promptBuilder";
import { getDestination, isYouTubeVideoUrl, STORAGE_KEYS } from "../lib/constants";
import { addHistoryEntry } from "../lib/history";
import {
  ensureSeeded,
  getProfiles,
  getSettings,
  resolveProfile,
  setPendingPrompt,
  takePendingPrompt,
} from "../lib/storage";
import type { RuntimeMessage, Settings, VideoContext } from "../types";

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

/** Rebuild the right-click menu to reflect the current profiles + destination. */
async function rebuildContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();

  const [profiles, settings] = await Promise.all([getProfiles(), getSettings()]);
  if (profiles.length === 0) return;

  const destination = getDestination(settings.destinationId);

  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: `Send to ${destination.label} with...`,
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

// Keep the menu title in sync when the default destination changes in Settings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEYS.settings]) return;
  const before = changes[STORAGE_KEYS.settings].oldValue as Settings | undefined;
  const after = changes[STORAGE_KEYS.settings].newValue as Settings | undefined;
  if (before?.destinationId !== after?.destinationId) void rebuildContextMenu();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ROOT) {
    // info.linkUrl is set when the click landed on a link (e.g. a thumbnail).
    void runSummary(info.menuItemId as string, info.linkUrl);
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

/** Briefly flash the toolbar badge: red for problems, green for success. */
async function flashBadge(text: string, ok = false): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#16a34a" : "#dc2626" });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 2500);
}

/** Ask the YouTube content script for the open video's transcript, if any. */
async function getTranscriptFromTab(tabId: number): Promise<string | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "GET_TRANSCRIPT",
    })) as { transcript: string | null } | undefined;
    return res?.transcript ?? null;
  } catch {
    return null;
  }
}

/**
 * Copy text to the clipboard from the background by delegating to a YouTube
 * tab's content script — the service worker has no DOM, but the content script
 * can write to the clipboard (the extension holds the clipboardWrite
 * permission). Returns whether the write succeeded.
 */
async function copyViaTab(tabId: number, text: string): Promise<boolean> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "COPY_TO_CLIPBOARD",
      text,
    })) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return false;
  }
}

/**
 * The core motion: read the target YouTube video, build the prompt from the
 * chosen (or default) profile, then route it to the default destination —
 * inject + submit for Gemini, or copy-with-transcript + open the site for
 * everyone else. `destinationOverride` lets the popup pick a destination for
 * one send without touching the saved default.
 */
async function runSummary(
  profileId?: string,
  linkUrl?: string,
  destinationOverride?: string,
): Promise<void> {
  // A right-clicked video link (a thumbnail) wins over the active tab, so a
  // suggested video gets summarized rather than the page you're sitting on.
  // Everything else — page right-click, toolbar icon, keyboard shortcut —
  // falls back to the active tab.
  const activeTab = await getActiveTab();
  const isThumbnail = !!(linkUrl && isYouTubeVideoUrl(linkUrl));

  let url: string | undefined;
  let title: string | undefined;
  if (isThumbnail) {
    url = linkUrl;
  } else {
    url = activeTab?.url;
    title = cleanTitle(activeTab?.title);
  }

  if (!url || !isYouTubeVideoUrl(url)) {
    await flashBadge("!");
    return;
  }

  const profile = await resolveProfile(profileId);
  if (!profile) return;

  const settings = await getSettings();
  const destination = getDestination(destinationOverride ?? settings.destinationId);
  const video: VideoContext = { url, title };

  if (destination.mode === "inject") {
    const prompt = buildDestinationPrompt(profile, video, destination);
    const geminiTab = await chrome.tabs.create({
      url: settings.geminiUrl,
      active: settings.focusGeminiTab,
    });
    if (geminiTab.id !== undefined) {
      await setPendingPrompt(geminiTab.id, prompt);
    }
    if (settings.saveHistoryOnSearch) {
      await addHistoryEntry({ video, profile, prompt, settings });
    }
    return;
  }

  // Clipboard destination. The transcript is only reachable when the active tab
  // IS the video being summarized — not when summarizing a suggested thumbnail.
  let transcript: string | null = null;
  if (!isThumbnail && activeTab?.id !== undefined) {
    transcript = await getTranscriptFromTab(activeTab.id);
  }
  const prompt = buildDestinationPrompt(profile, video, destination, transcript);

  let copied = false;
  if (activeTab?.id !== undefined) {
    copied = await copyViaTab(activeTab.id, prompt);
  }
  await chrome.tabs.create({ url: destination.url, active: true });
  await flashBadge(copied ? "✓" : "!", copied);

  if (settings.saveHistoryOnSearch) {
    await addHistoryEntry({ video, profile, prompt, settings });
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "ask-gemini") void runSummary();
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "ASK") {
      void runSummary(message.profileId, undefined, message.destinationId).then(
        () => sendResponse({ ok: true }),
      );
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
