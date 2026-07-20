import { buildDestinationPrompt } from "../lib/promptBuilder";
import { parseTldwBlock } from "../lib/tldw";
import { selectSummaryProfile } from "../lib/summaryProfile";
import { fingerprintPrompt } from "../lib/summaryCache";
import { verifyGeminiKey } from "../lib/geminiKeyValidation";
import { callGeminiApi, GeminiApiError, normalizeGeminiError } from "../lib/geminiApi";
import { GEMINI_MODEL_ID, GEMINI_URL, getDestination, isYouTubeVideoUrl, localDateKey, STORAGE_KEYS } from "../lib/constants";
import { addHistoryEntry, expireOldEntries, trimToLimit } from "../lib/history";
import {
  addOpenSearch,
  beginGeminiCall,
  bumpLifetimeStats,
  clearCachedSummaries,
  ensureSeeded,
  getActiveTags,
  getCachedSummary,
  getCachedSummaryCount,
  getHistory,
  getOpenSearches,
  getProfiles,
  getSettings,
  maintainSummaryCache,
  pruneOpenSearch,
  pruneOrphanVideoTags,
  recordDeliveryStatus,
  finishGeminiCall,
  clearPendingPrompt,
  peekPendingPrompt,
  setCachedSummary,
  setHistory,
  setPendingPrompt,
  setSettings,
} from "../lib/storage";
import { extractVideoId } from "../lib/constants";
import type { OpenSearch, RuntimeMessage, Settings, SummarySource, VideoContext, VideoMeta } from "../types";

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

/**
 * Bound storage even when the user goes quiet. History expiry and cache pruning
 * normally run on write, so a user who stops summarizing would keep stale data
 * indefinitely. This sweep runs on browser startup (and install) to apply the
 * 30-day auto-delete and the cache TTL/cap regardless of activity.
 */
async function startupStorageSweep(): Promise<void> {
  try {
    const settings = await getSettings();
    const history = await getHistory();
    if (history.length > 0) {
      const next = trimToLimit(expireOldEntries(history, settings), settings.historyLimit);
      if (next.length !== history.length) await setHistory(next);
    }
    await maintainSummaryCache();
    // One-time cleanup: the "block channel" feature was removed, so drop its
    // now-orphaned storage key for users who had blocked channels (no-op after).
    await chrome.storage.local.remove("tldwBlockedChannels");
    // Sweep video-tag assignments whose video has left history — the one
    // otherwise-unbounded storage map.
    await pruneOrphanVideoTags();
  } catch {
    /* never let a maintenance sweep throw on startup */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSeeded().then(() => rebuildContextMenu());
  void startupStorageSweep();
});

chrome.runtime.onStartup.addListener(() => {
  void startupStorageSweep();
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
    // The menu reads "Send to <destination> with..." — an explicit request to
    // open that destination — so it always opens a tab, even with Direct API on.
    void runSummary(info.menuItemId as string, info.linkUrl, undefined, undefined, undefined, "menu");
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

/** Verify the saved key with a metadata read. This is not an inference request. */
async function verifySavedGeminiKey() {
  const before = await getSettings();
  const apiKey = before.geminiApiKey.trim();
  if (!apiKey) return { ok: false, validation: { status: "unverified" as const } };

  const validation = await verifyGeminiKey(apiKey);

  const current = await getSettings();
  if (current.geminiApiKey === before.geminiApiKey) {
    await setSettings({ ...current, geminiKeyValidation: validation });
  }
  return { ok: validation.status === "valid", validation };
}

/**
 * The core motion: read the target YouTube video, build the prompt from the
 * chosen (or default) profile, then open the destination tab and hand the
 * prompt to its injector to auto-fill and submit. `destinationOverride` lets
 * the popup pick a destination for one send without touching the saved default.
 *
 * `senderTabId` is passed when the request comes from a content script (auto-run
 * or in-page "Ask" button). Using the sender's tab ID directly avoids the
 * race condition where `getActiveTab()` returns the wrong tab if the user
 * switches windows between the content script firing and the service worker
 * processing the message.
 *
 * `source` records which entry point fired the send. Explicit user gestures —
 * the right-click menu, the popup's Send button, and the Alt+Shift+G keyboard
 * shortcut — open the chosen (or default) destination tab even when Direct API
 * is enabled, because the user is deliberately asking to send the video. Only
 * the in-page auto-run ("auto") stays headless when Direct API is on, filling
 * the TL;DW widget in place. Defaults to "auto" so the existing in-page path
 * keeps its headless behavior.
 */
async function runSummary(
  profileId?: string,
  linkUrl?: string,
  destinationOverride?: string,
  userCuriosity?: string,
  senderTabId?: number,
  source: SummarySource = "auto",
  forceFocusTab = false,
  bypassCache = false,
): Promise<void> {
  // A right-clicked video link (a thumbnail) wins over the active tab, so a
  // suggested video gets summarized rather than the page you're sitting on.
  // Everything else — page right-click, toolbar icon, keyboard shortcut —
  // falls back to the active tab.
  let activeTab: chrome.tabs.Tab | undefined;
  if (senderTabId !== undefined) {
    try { activeTab = await chrome.tabs.get(senderTabId); } catch { /* tab closed */ }
  }
  if (!activeTab) activeTab = await getActiveTab();
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

  const [settings, profiles] = await Promise.all([getSettings(), getProfiles()]);
  const destination = getDestination(destinationOverride ?? settings.destinationId);
  const video: VideoContext = { url, title };

  // Pause the video you're on (not a suggested thumbnail) before we hand off.
  if (settings.autoPauseOnSummarize && !isThumbnail && activeTab?.id !== undefined) {
    void chrome.tabs.sendMessage(activeTab.id, { type: "PAUSE_VIDEO" }).catch(() => {});
  }

  const isPromptDest = destination.payload !== "link" && destination.payload !== "source";
  // Determine headless path early so the transcript fetch can account for it.
  // Explicit "open this destination" gestures — the right-click menu, the popup
  // Send button, and the Alt+Shift+G keyboard shortcut — always open the
  // destination tab with the chosen (or default) profile. Direct API headless
  // mode applies to the in-page auto-run AND the popup's inline-summarize action
  // ("popup-inline"), both of which want the TL;DW widget filled on the page.
  const opensTab = source === "menu" || source === "popup" || source === "command";
  const apiKey = settings.geminiApiKey?.trim();
  const willUseDirectApi = !!(apiKey && settings.useDirectApi && isPromptDest && !opensTab);
  const profile = selectSummaryProfile(profiles, settings, source, profileId, willUseDirectApi);
  if (!profile) return;

  // Fetch the transcript for any prompt/source destination. Originally we
  // skipped it for "canWatch" Gemini and let the web app watch the URL — but the
  // Gemini web app watches YouTube unreliably (especially in a background tab),
  // so the structured TL;DW block often never comes back. Including the
  // transcript makes the tab flow as reliable as the headless path.
  let transcript: string | null = null;
  if (
    destination.payload !== "link" &&
    !isThumbnail &&
    activeTab?.id !== undefined
  ) {
    transcript = await getTranscriptFromTab(activeTab.id);
  }

  // Fetch video metadata ONCE for any non-thumbnail prompt destination — used for
  // channel-tracking stats, the duration-summarized stat, AND tag resolution. It
  // must run on EVERY prompt path (not just Direct-API) so channel tags resolve
  // even on the plain tab-flow. Consolidated from the two separate fetches this
  // had before.
  let videoDurationSeconds = 0;
  if (isPromptDest && !isThumbnail && activeTab?.id !== undefined) {
    const meta = await getVideoMeta(activeTab.id);
    if (meta?.channel) video.channel = meta.channel;
    if (meta?.channelId) video.channelId = meta.channelId;
    if (meta?.avatarUrl) video.avatarUrl = meta.avatarUrl;
    if (meta?.durationSeconds) videoDurationSeconds = meta.durationSeconds;
  }

  // Resolve the user's active tags for this video (F6): channel tags ∪ video
  // tags. Channel tags are matched by id OR name (the widget keys by id with name
  // fallback). Woven into every prompt build below so tagged asks (e.g. citations)
  // shape both the Direct-API and tab-flow summaries.
  const activeTags = await getActiveTags({
    channelId: video.channelId,
    channelName: video.channel,
    videoId: extractVideoId(url) ?? undefined,
  });

  // Whenever we actually have a transcript, append it to the prompt (treat the
  // destination as non-watching) rather than relying on the AI to open the URL.
  // This covers both the headless REST path and the tab flow (incl. Gemini).
  const promptDest =
    willUseDirectApi || transcript ? { ...destination, canWatch: false } : destination;
  const prompt = buildDestinationPrompt(profile, video, promptDest, transcript, userCuriosity, activeTags);

  // --- headless path: call Gemini API directly (no tab) -------------------
  if (willUseDirectApi) {
    // Build the transcript-free prompt once for both the call log and history.
    const logPrompt = buildDestinationPrompt(profile, video, destination, null, userCuriosity, activeTags);

    const videoId = extractVideoId(url);
    const modelOrDestination = GEMINI_MODEL_ID;
    const promptFingerprint = await fingerprintPrompt(prompt, modelOrDestination);

    // --- cache check: serve a previous result instantly, skip the API call ---
    const cachedSummary = videoId && !bypassCache
      ? await getCachedSummary(videoId, promptFingerprint)
      : null;
    if (cachedSummary && activeTab?.id !== undefined) {
      void chrome.tabs
        .sendMessage(activeTab.id, {
          type: "SET_SUMMARY",
          tldw: cachedSummary.tldw,
          source: `cached · ${cachedSummary.profileName}`,
          videoId,
        })
        .catch(() => {});
      // Bump lifetime stats: cache hit.
      void bumpLifetimeStats((s) => { s.cacheHits += 1; });
      void flashBadge("✓", true);
      return;
    }

    // --- live call: fetch from Gemini, then write to cache ---
    let responseText: string | undefined;
    let tldw: ReturnType<typeof parseTldwBlock> | undefined;
    let callId: string | undefined;
    try {
      callId = await beginGeminiCall(video, prompt, profile);
      responseText = await callGeminiApi(prompt, apiKey!);
      tldw = parseTldwBlock(responseText);
      if (!tldw) {
        throw new GeminiApiError("malformed_response");
      }
      await finishGeminiCall(callId, "success", { response: responseText });

      // Save history. Wrapped in its own try so a storage error never prevents
      // the summary from being shown.
      if (settings.saveHistoryOnSearch) {
        try {
          await addHistoryEntry({
            video, profile, prompt: logPrompt, settings,
            destinationId: destination.id,
            channelAvatarUrl: video.avatarUrl,
          });
        } catch { /* storage failure: skip history, don't block summary */ }
      }

      if (activeTab?.id !== undefined) {
        void chrome.tabs
          .sendMessage(activeTab.id, { type: "SET_SUMMARY", tldw, source: "Gemini API", videoId })
          .catch(() => {});

        // Cache the result so future visits to this video skip the API call.
        if (videoId) {
          void setCachedSummary({
            videoId,
            promptFingerprint,
            tldw,
            profileId: profile.id,
            profileName: profile.name,
            modelOrDestination,
            createdAt: new Date().toISOString(),
          });
        }

        // Bump lifetime stats: summary completed (Direct API path).
        const today = localDateKey();
        const durSec = videoDurationSeconds;
        void bumpLifetimeStats((s) => {
          s.summaries += 1;
          s.activity[today] = (s.activity[today] ?? 0) + 1;
          if (durSec > 0) s.durationSummarizedSeconds += durSec;
        });
      }
      void flashBadge("✓", true);
      void recordDeliveryStatus({ site: "Gemini (API)", ok: true, at: new Date().toISOString() });
    } catch (err) {
      const apiError = normalizeGeminiError(err);
      const reason = apiError.message;
      if (callId) {
        void finishGeminiCall(callId, "failure", {
          response: responseText,
          httpStatus: apiError.httpStatus,
          errorCategory: apiError.category,
        });
      }
      void flashBadge("!");
      void recordDeliveryStatus({
        site: "Gemini (API)",
        ok: false,
        reason,
        at: new Date().toISOString(),
      });
      // Surface the failure on the page so the skeleton is replaced immediately
      // with the real reason + a retry, rather than hanging until the 90s timeout.
      if (activeTab?.id !== undefined) {
        void chrome.tabs
          .sendMessage(activeTab.id, {
            type: "SET_SUMMARY_ERROR",
            videoId,
            reason,
            actionUrl: apiError.actionUrl,
          })
          .catch(() => {});
      }
    }
    return;
  }

  const tabVideoId = extractVideoId(video.url);
  const tabPromptFingerprint = tabVideoId
    ? await fingerprintPrompt(prompt, destination.id)
    : undefined;
  const tabCachedSummary = tabVideoId && tabPromptFingerprint && !bypassCache
    ? await getCachedSummary(tabVideoId, tabPromptFingerprint)
    : null;
  if (tabCachedSummary && activeTab?.id !== undefined) {
    void chrome.tabs.sendMessage(activeTab.id, {
      type: "SET_SUMMARY",
      tldw: tabCachedSummary.tldw,
      source: `cached · ${tabCachedSummary.profileName}`,
      videoId: tabVideoId,
    }).catch(() => {});
    void bumpLifetimeStats((stats) => { stats.cacheHits += 1; });
    void flashBadge("✓", true);
    return;
  }

  // Open the destination tab and hand its injector the prompt to auto-fill.
  // Gemini's URL is fixed (GEMINI_URL); the rest open their configured URL.
  // When temporary chats are on, prefer the incognito URL if the destination
  // has one (Claude, ChatGPT). Gemini has no incognito URL —
  // its content script clicks the temp-chat button instead.
  const baseUrl = destination.id === "gemini" ? GEMINI_URL : destination.url;
  const targetUrl =
    settings.temporaryChats && destination.incognitoUrl
      ? destination.incognitoUrl
      : baseUrl;
  const injectTab = await chrome.tabs.create({
    url: targetUrl,
    active: forceFocusTab || settings.focusGeminiTab,
  });
  if (injectTab.id !== undefined) {
    await setPendingPrompt(injectTab.id, { prompt, sourceTabId: activeTab?.id });
    await recordOpenSearch(
      injectTab.id,
      video,
      destination,
      activeTab?.id,
      tabVideoId && tabPromptFingerprint
        ? {
            videoId: tabVideoId,
            promptFingerprint: tabPromptFingerprint,
            profileId: profile.id,
            profileName: profile.name,
            modelOrDestination: destination.id,
          }
        : undefined,
    );
  }
  if (settings.saveHistoryOnSearch) {
    // Store a transcript-free prompt: the transcript can be tens to hundreds of
    // KB, and persisting it per entry would bloat chrome.storage.local toward
    // its ~5 MB quota (and means "Copy prompt" wouldn't quietly drag the whole
    // transcript along). Rebuild the prompt with no transcript for the log.
    const historyPrompt = buildDestinationPrompt(profile, video, destination, null, userCuriosity, activeTags);
    await addHistoryEntry({
      video,
      profile,
      prompt: historyPrompt,
      settings,
      destinationId: destination.id,
      channelAvatarUrl: video.avatarUrl,
    });
  }
}

/** Remember a destination tab we opened, so the popup can offer "jump back". */
async function recordOpenSearch(
  tabId: number,
  video: VideoContext,
  destination: { id: string; label: string },
  sourceTabId?: number,
  cacheContext?: import("../types").OpenSearch["cacheContext"],
): Promise<void> {
  await addOpenSearch({
    tabId,
    sourceTabId,
    videoUrl: video.url,
    videoTitle: video.title,
    destinationId: destination.id,
    destinationLabel: destination.label,
    createdAt: new Date().toISOString(),
    cacheContext,
  });
}

// Forget a search and drop any unconsumed pending prompt the moment its tab
// closes (peek-don't-consume means an undelivered prompt would otherwise linger
// and could be mis-served to a recycled tab id).
chrome.tabs.onRemoved.addListener((tabId) => {
  void pruneOpenSearch(tabId);
  void clearPendingPrompt(tabId);
});

chrome.commands.onCommand.addListener((command) => {
  // Alt+Shift+G opens the destination tab with the default profile — same as the
  // toolbar/menu, and unaffected by an in-page auto-summary running on Direct API.
  if (command === "ask-gemini") void runSummary(undefined, undefined, undefined, undefined, undefined, "command");
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "ASK") {
      // Content-script auto-runs omit `source` and default to "auto" (headless
      // when Direct API is on); the popup's Send button passes "popup" so it
      // opens the chosen destination tab like the right-click menu, and the
      // popup's inline action passes "popup-inline" to run headless (no tab).
      void runSummary(
        message.profileId,
        undefined,
        message.destinationId,
        message.userCuriosity,
        message.sourceTabId ?? sender.tab?.id,
        message.source ?? "auto",
        false,
        message.bypassCache ?? false,
      ).then(
        () => sendResponse({ ok: true }),
        // runSummary has awaits outside its inner try (tabs.create, storage
        // writes) that can reject. Without this, the rejection is unhandled AND
        // the promised response never arrives, so the caller's port hangs until
        // Chrome times it out and its loading panel stalls.
        (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
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
      // The injector finished its attempt — drop the (peeked-not-consumed)
      // pending prompt now so it isn't re-delivered, but only after a real
      // attempt completed (so a slow-mounting composer kept its chance to retry).
      if (sender.tab?.id !== undefined) void clearPendingPrompt(sender.tab.id);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "AI_SUMMARY") {
      // Resolve which YouTube video this scrape was for so the content script can
      // drop it if the user has since navigated away (otherwise it renders/caches
      // on the wrong video). openSearches maps the destination tab (the sender)
      // back to the source video URL.
      const destTabId = sender.tab?.id;
      const srcTabId = message.sourceTabId;
      void (async () => {
        let videoId: string | undefined;
        let match: OpenSearch | undefined;
        try {
          const searches = await getOpenSearches();
          match =
            searches.find((s) => destTabId !== undefined && s.tabId === destTabId) ??
            searches.find((s) => s.sourceTabId === srcTabId);
          if (match?.videoUrl) videoId = extractVideoId(match.videoUrl) ?? undefined;
          if (match?.cacheContext) {
            await setCachedSummary({
              ...match.cacheContext,
              tldw: message.tldw,
              createdAt: new Date().toISOString(),
            });
          }
        } catch { /* best effort — fall back to no guard */ }
        void chrome.tabs
          .sendMessage(srcTabId, {
            type: "SET_SUMMARY",
            tldw: message.tldw,
            source: match?.destinationLabel,
            videoId,
          })
          .catch(() => {});
      })();
      // Bump lifetime stats: summary completed (tab-scrape / AI_SUMMARY path).
      const today = localDateKey();
      void bumpLifetimeStats((s) => {
        s.summaries += 1;
        s.activity[today] = (s.activity[today] ?? 0) + 1;
        // Duration is not available from the AI_SUMMARY message; skip it.
      });
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "GET_SPONSOR_SEGMENTS") {
      // Fetch sponsor segments from the free SponsorBlock community API. Done in
      // the worker (not the content script) so host_permissions bypass CORS.
      // SponsorBlock returns 404 when a video has no submitted segments — that's
      // a normal "nothing to skip", not an error.
      const videoId = message.videoId;
      void (async () => {
        try {
          const url =
            "https://sponsor.ajay.app/api/skipSegments?videoID=" +
            encodeURIComponent(videoId) +
            "&categories=" +
            encodeURIComponent(JSON.stringify(["sponsor"]));
          const res = await fetch(url);
          if (!res.ok) {
            sendResponse({ segments: [] });
            return;
          }
          const data = (await res.json()) as Array<{ segment: [number, number]; category: string }>;
          const segments = (Array.isArray(data) ? data : [])
            .filter((d) => Array.isArray(d.segment) && d.segment.length === 2)
            .map((d) => ({ start: d.segment[0], end: d.segment[1], category: d.category }));
          sendResponse({ segments });
        } catch {
          sendResponse({ segments: [] });
        }
      })();
      return true; // async response
    }
    if (message.type === "CACHE_LOOKUP") {
      void getCachedSummary(message.videoId).then(async (entry) => {
        if (entry) {
          await bumpLifetimeStats((stats) => { stats.cacheHits += 1; });
        }
        sendResponse({ entry });
      });
      return true;
    }
    if (message.type === "CACHE_CLEAR") {
      void clearCachedSummaries(message.videoId).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "CACHE_COUNT") {
      void getCachedSummaryCount().then((count) => sendResponse({ count }));
      return true;
    }
    if (message.type === "VERIFY_GEMINI_KEY") {
      void verifySavedGeminiKey().then(sendResponse);
      return true;
    }
    if (message.type === "OPEN_OR_FOCUS_DESTINATION") {
      const ytTabId = sender.tab?.id;
      const ytUrl = sender.tab?.url;
      void (async () => {
        // Reuse the destination tab we already scraped for this video if it's
        // still open — focus it instead of spawning a duplicate.
        const searches = await getOpenSearches(); // prunes closed tabs
        const ytVideoId = ytUrl ? extractVideoId(ytUrl) : null;
        const match =
          searches.find((s) => ytTabId !== undefined && s.sourceTabId === ytTabId) ??
          (ytVideoId
            ? searches.find((s) => s.videoUrl && extractVideoId(s.videoUrl) === ytVideoId)
            : undefined);
        if (match) {
          try {
            const t = await chrome.tabs.get(match.tabId);
            await chrome.tabs.update(match.tabId, { active: true });
            if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
            sendResponse({ focused: true });
            return;
          } catch {
            /* tab vanished between prune and focus — fall through to open */
          }
        }
        // None open — run a fresh summary that opens the destination tab, and
        // force-focus it (this is an explicit "take me there" click).
        await runSummary(undefined, undefined, undefined, undefined, ytTabId, "popup", true);
        sendResponse({ opened: true });
      })();
      return true; // async response
    }
    if (message.type === "OPEN_OPTIONS") {
      const section = message.section;
      if (section) {
        // Deep-link to a sidebar section via the page's URL hash. Focus an
        // existing options tab if one's open (so the address bar updates in
        // place) rather than piling up duplicates; otherwise open a new tab.
        const base = chrome.runtime.getURL(
          chrome.runtime.getManifest().options_ui?.page ?? "src/options/index.html",
        );
        const url = `${base}#${section}`;
        void (async () => {
          const tabs = await chrome.tabs.query({});
          const existing = tabs.find(
            (tb) => tb.url?.startsWith(base) || tb.pendingUrl?.startsWith(base),
          );
          if (existing?.id != null) {
            await chrome.tabs.update(existing.id, { url, active: true });
            if (existing.windowId != null) {
              await chrome.windows.update(existing.windowId, { focused: true });
            }
          } else {
            await chrome.tabs.create({ url });
          }
        })();
      } else {
        void chrome.runtime.openOptionsPage();
      }
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "SPONSOR_SKIPPED") {
      const { secondsSaved } = message;
      void bumpLifetimeStats((s) => {
        s.sponsorSkips += 1;
        s.sponsorSecondsSaved += secondsSaved;
      });
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "REBUILD_MENU") {
      void rebuildContextMenu().then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
      return true;
    }
    if (message.type === "GET_PENDING") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({ prompt: null });
        return true;
      }
      // Peek, don't consume: the prompt is cleared on INJECT_RESULT instead, so
      // a composer that mounts late on a cold load still gets filled.
      void Promise.all([peekPendingPrompt(tabId), getSettings()]).then(
        ([pending, settings]) =>
          sendResponse({
            prompt: pending?.prompt ?? null,
            autoSubmit: settings.autoSubmit,
            temporaryChats: settings.temporaryChats,
            sourceTabId: pending?.sourceTabId,
          }),
        // Always respond even on a storage error, so the injector's port doesn't
        // hang (consistent with the ASK handler).
        () => sendResponse({ prompt: null }),
      );
      return true;
    }
    return false;
  },
);
