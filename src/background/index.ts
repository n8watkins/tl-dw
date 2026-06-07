import { buildDestinationPrompt, prependWorthWatchingGate } from "../lib/promptBuilder";
import { parseTldwBlock } from "../lib/tldw";
import { getDestination, isYouTubeVideoUrl, STORAGE_KEYS } from "../lib/constants";
import { addHistoryEntry } from "../lib/history";
import {
  addOpenSearch,
  clearGeminiUsage,
  ensureSeeded,
  getGeminiUsage,
  getProfiles,
  getSettings,
  pruneOpenSearch,
  recordDeliveryStatus,
  recordGeminiCall,
  resolveProfile,
  setPendingPrompt,
  takePendingPrompt,
} from "../lib/storage";
import type { GeminiUsage, RuntimeMessage, Settings, VideoContext, VideoMeta } from "../types";

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

/** Ask the YouTube content script for the video's duration + channel. */
async function getVideoMeta(tabId: number): Promise<VideoMeta | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "GET_VIDEO_META",
    })) as VideoMeta | undefined;
    return res ?? null;
  } catch {
    return null;
  }
}

/** Whether a channel/title is on the gate's bypass (trusted) list. */
function isTrusted(bypassTerms: string, channel: string, title?: string): boolean {
  const haystack = `${channel} ${title ?? ""}`.toLowerCase();
  return bypassTerms
    .split(/[\n,]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((term) => haystack.includes(term));
}

/** Call the Gemini REST API directly and return the response text. */
async function callGeminiApi(prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

/**
 * The core motion: read the target YouTube video, build the prompt from the
 * chosen (or default) profile, then open the destination tab and hand the
 * prompt to its injector to auto-fill and submit. `destinationOverride` lets
 * the popup pick a destination for one send without touching the saved default.
 */
async function runSummary(
  profileId?: string,
  linkUrl?: string,
  destinationOverride?: string,
  gateOverride?: boolean,
  userCuriosity?: string,
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

  let profile = await resolveProfile(profileId);
  if (!profile) return;

  const settings = await getSettings();
  const destination = getDestination(destinationOverride ?? settings.destinationId);
  const video: VideoContext = { url, title };

  // Pause the video you're on (not a suggested thumbnail) before we hand off.
  if (settings.autoPauseOnSummarize && !isThumbnail && activeTab?.id !== undefined) {
    void chrome.tabs.sendMessage(activeTab.id, { type: "PAUSE_VIDEO" }).catch(() => {});
  }

  const isPromptDest = destination.payload !== "link" && destination.payload !== "source";
  // Determine headless path early so the transcript fetch can account for it.
  const apiKey = settings.geminiApiKey?.trim();
  const willUseDirectApi = !!(apiKey && settings.useDirectApi && isPromptDest);

  // Fetch the transcript whenever the destination can't watch the video itself,
  // OR when going headless — the Gemini REST API can't watch YouTube URLs, so
  // it needs the transcript even though destination.canWatch is true for Gemini.
  let transcript: string | null = null;
  if (
    (!destination.canWatch || willUseDirectApi) &&
    destination.payload !== "link" &&
    !isThumbnail &&
    activeTab?.id !== undefined
  ) {
    transcript = await getTranscriptFromTab(activeTab.id);
  }

  // Worth-watching gate: for chat destinations (a "prompt" payload), on videos
  // over the threshold whose channel/title isn't trusted, ask for a verdict
  // first. The meta fetch also enriches the prompt's {{channel}}.
  const gateEnabled = gateOverride ?? settings.worthWatchingGate;
  let gateMinutes = 0;
  if (gateEnabled && isPromptDest && !isThumbnail && activeTab?.id !== undefined) {
    const meta = await getVideoMeta(activeTab.id);
    if (meta?.channel) video.channel = meta.channel;
    const minutes = (meta?.durationSeconds ?? 0) / 60;
    // Record the duration read as a "gate" status every run: a failed read
    // surfaces a notice (the selector may need a look), and a later good read
    // clears that stale notice rather than letting it stick around.
    await recordDeliveryStatus({
      site: destination.label,
      kind: "gate",
      ok: minutes > 0,
      reason:
        minutes > 0
          ? undefined
          : "couldn't read the video length — verdict gate skipped",
      at: new Date().toISOString(),
    });
    if (
      minutes >= settings.worthWatchingMinutes &&
      !isTrusted(settings.gateBypassTerms, meta?.channel ?? "", title)
    ) {
      gateMinutes = minutes;
    }
  }

  // For headless calls the REST API can't watch YouTube, so treat the
  // destination as non-watching so the transcript is appended to the prompt.
  const promptDest = willUseDirectApi ? { ...destination, canWatch: false } : destination;
  let prompt = buildDestinationPrompt(profile, video, promptDest, transcript, userCuriosity);
  if (gateMinutes > 0) {
    prompt = prependWorthWatchingGate(prompt, gateMinutes);
  }

  // For headless runs, use the designated Direct API profile if one is set.
  if (willUseDirectApi && settings.directApiProfileId) {
    profile = (await resolveProfile(settings.directApiProfileId)) ?? profile;
  }

  // --- headless path: call Gemini API directly (no tab) -------------------
  if (willUseDirectApi) {
    // Build the transcript-free prompt once for both the call log and history.
    let logPrompt = buildDestinationPrompt(profile, video, destination, null, userCuriosity);
    if (gateMinutes > 0) logPrompt = prependWorthWatchingGate(logPrompt, gateMinutes);

    let responseText: string | undefined;
    try {
      responseText = await callGeminiApi(prompt, apiKey!);
      void recordGeminiCall(video, logPrompt, responseText);
      const tldw = parseTldwBlock(responseText);
      if (tldw && activeTab?.id !== undefined) {
        void chrome.tabs
          .sendMessage(activeTab.id, { type: "SET_SUMMARY", tldw, source: "Gemini API" })
          .catch(() => {});
      }
      void flashBadge("✓", true);
      void recordDeliveryStatus({ site: "Gemini (API)", ok: true, at: new Date().toISOString() });
    } catch (err) {
      void flashBadge("!");
      void recordDeliveryStatus({
        site: "Gemini (API)",
        ok: false,
        reason: err instanceof Error ? err.message : "API call failed",
        at: new Date().toISOString(),
      });
    }
    if (settings.saveHistoryOnSearch) {
      await addHistoryEntry({
        video, profile, prompt: logPrompt, settings,
        destinationId: destination.id,
        apiResponse: responseText,
      });
    }
    return;
  }

  // Open the destination tab and hand its injector the prompt to auto-fill.
  // Gemini's URL is user-configurable; the rest open their fixed URL.
  // When temporary chats are on, prefer the incognito URL if the destination
  // has one (Claude, ChatGPT). Gemini has no incognito URL —
  // its content script clicks the temp-chat button instead.
  const baseUrl = destination.id === "gemini" ? settings.geminiUrl : destination.url;
  const targetUrl =
    settings.temporaryChats && destination.incognitoUrl
      ? destination.incognitoUrl
      : baseUrl;
  const injectTab = await chrome.tabs.create({
    url: targetUrl,
    active: settings.focusGeminiTab,
  });
  if (injectTab.id !== undefined) {
    await setPendingPrompt(injectTab.id, { prompt, sourceTabId: activeTab?.id });
    await recordOpenSearch(injectTab.id, video, destination, activeTab?.id);
  }
  if (settings.saveHistoryOnSearch) {
    // Store a transcript-free prompt: the transcript can be tens to hundreds of
    // KB, and persisting it per entry would bloat chrome.storage.local toward
    // its ~10 MB quota (and means "Copy prompt" wouldn't quietly drag the whole
    // transcript along). Rebuild the prompt with no transcript for the log.
    let historyPrompt = buildDestinationPrompt(profile, video, destination, null, userCuriosity);
    if (gateMinutes > 0) {
      historyPrompt = prependWorthWatchingGate(historyPrompt, gateMinutes);
    }
    await addHistoryEntry({
      video,
      profile,
      prompt: historyPrompt,
      settings,
      destinationId: destination.id,
    });
  }
}

/** Remember a destination tab we opened, so the popup can offer "jump back". */
async function recordOpenSearch(
  tabId: number,
  video: VideoContext,
  destination: { id: string; label: string },
  sourceTabId?: number,
): Promise<void> {
  await addOpenSearch({
    tabId,
    sourceTabId,
    videoUrl: video.url,
    videoTitle: video.title,
    destinationId: destination.id,
    destinationLabel: destination.label,
    createdAt: new Date().toISOString(),
  });
}

// Forget a search the moment its tab closes.
chrome.tabs.onRemoved.addListener((tabId) => void pruneOpenSearch(tabId));

chrome.commands.onCommand.addListener((command) => {
  if (command === "ask-gemini") void runSummary();
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "ASK") {
      void runSummary(
        message.profileId,
        undefined,
        message.destinationId,
        message.worthWatchingGate,
        message.userCuriosity,
      ).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "INJECT_RESULT") {
      void recordDeliveryStatus({
        site: message.site,
        ok: message.ok,
        reason: message.reason,
        at: new Date().toISOString(),
      });
      void flashBadge(message.ok ? "✓" : "!", message.ok);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "AI_SUMMARY") {
      void chrome.tabs
        .sendMessage(message.sourceTabId, { type: "SET_SUMMARY", tldw: message.tldw })
        .catch(() => {});
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "GET_GEMINI_USAGE") {
      void getGeminiUsage().then((usage: GeminiUsage) => sendResponse(usage));
      return true;
    }
    if (message.type === "CLEAR_GEMINI_USAGE") {
      void clearGeminiUsage().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "OPEN_OPTIONS") {
      void chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;
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
        ([pending, settings]) =>
          sendResponse({
            prompt: pending?.prompt ?? null,
            autoSubmit: settings.autoSubmit,
            temporaryChats: settings.temporaryChats,
            sourceTabId: pending?.sourceTabId,
          }),
      );
      return true;
    }
    return false;
  },
);
