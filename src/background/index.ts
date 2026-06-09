import { buildDestinationPrompt, prependWorthWatchingGate } from "../lib/promptBuilder";
import { parseTldwBlock } from "../lib/tldw";
import { getDestination, isYouTubeVideoUrl, STORAGE_KEYS } from "../lib/constants";
import { addHistoryEntry, computeChannelStats } from "../lib/history";
import type { ChannelStats } from "../lib/history";
import {
  addOpenSearch,
  addRatingOnlyHistoryEntry,
  clearGeminiUsage,
  ensureSeeded,
  getCachedSummary,
  getGeminiUsage,
  getHistory,
  getOpenSearches,
  getProfiles,
  getSettings,
  patchCachedSummary,
  patchGeminiCallEntry,
  patchHistoryEntryAudienceScore,
  patchHistoryEntryRating,
  pruneOpenSearch,
  recordDeliveryStatus,
  recordGeminiCallReturningId,
  resolveProfile,
  setCachedSummary,
  setPendingPrompt,
  takePendingPrompt,
} from "../lib/storage";
import { extractVideoId } from "../lib/constants";
import type { GeminiUsage, RuntimeMessage, Settings, SummarySource, VideoContext, VideoMeta } from "../types";

const MENU_ROOT = "tldw-root";

/** Per-channel averages sent to the content panel for the this-video-vs-channel cues. */
type ChannelComparisonStats = Pick<
  ChannelStats,
  "avgAiRating" | "avgAudienceScore" | "count" | "avgUserRating" | "userBreakdown"
>;

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
    // The menu reads "Send to <destination> with..." — an explicit request to
    // open that destination — so it always opens a tab, even with Direct API on.
    void runSummary(info.menuItemId as string, info.linkUrl, undefined, undefined, undefined, undefined, "menu");
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

/** Ask the YouTube content script for the top viewer comments on the page. */
async function getCommentsFromTab(tabId: number): Promise<string | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "GET_COMMENTS",
    })) as { comments: string | null } | undefined;
    return res?.comments ?? null;
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;
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
 * Fetch top comments from `tabId`, call Gemini for sentiment, and send
 * `SET_COMMENT_SENTIMENT` back to the tab. Patches the summary cache and call
 * log if IDs are supplied. Best-effort: clears the shimmer on any failure.
 */
async function runCommentSentiment(
  tabId: number | undefined,
  apiKey: string,
  settings: Settings,
  videoId?: string | null,
  callEntryId?: string,
): Promise<void> {
  if (tabId === undefined) return;
  try {
    const comments = await getCommentsFromTab(tabId);
    if (!comments) {
      void chrome.tabs.sendMessage(tabId, { type: "SET_COMMENT_SENTIMENT" }).catch(() => {});
      return;
    }
    const commentPrompt = settings.commentPromptTemplate.replace("{{comments}}", comments);
    const commentResponse = await callGeminiApi(commentPrompt, apiKey);

    const scoreMatch = /Audience score:\s*(\d+)\/10/i.exec(commentResponse);
    const audienceScore = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;
    const sentiment = commentResponse
      .replace(/^.*Audience score:\s*\d+\/10.*$/im, "")
      .trim();

    void chrome.tabs
      .sendMessage(tabId, { type: "SET_COMMENT_SENTIMENT", sentiment, audienceScore })
      .catch(() => {});

    if (callEntryId) void patchGeminiCallEntry(callEntryId, { commentSentiment: sentiment, audienceScore });
    if (videoId) void patchCachedSummary(videoId, { commentSentiment: sentiment, audienceScore });
    // Patch the score into history too so the channel community average includes this video.
    if (videoId && audienceScore !== undefined) void patchHistoryEntryAudienceScore(videoId, audienceScore);
  } catch {
    void chrome.tabs.sendMessage(tabId, { type: "SET_COMMENT_SENTIMENT" }).catch(() => {});
  }
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
  gateOverride?: boolean,
  userCuriosity?: string,
  senderTabId?: number,
  source: SummarySource = "auto",
  forceFocusTab = false,
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
  // Explicit user gestures — the right-click menu, the popup Send button, and
  // the Alt+Shift+G keyboard shortcut — always open the destination tab with the
  // chosen (or default) profile. Direct API headless mode only applies to the
  // in-page auto-run, which wants the TL;DW widget filled on the page itself.
  const opensTab = source === "menu" || source === "popup" || source === "command";
  const apiKey = settings.geminiApiKey?.trim();
  const willUseDirectApi = !!(apiKey && settings.useDirectApi && isPromptDest && !opensTab);

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

  // Always fetch video metadata for headless runs so we can store the channel
  // name and avatar for channel-tracking stats, even when the gate is off.
  if (willUseDirectApi && !isThumbnail && activeTab?.id !== undefined) {
    const meta = await getVideoMeta(activeTab.id);
    if (meta?.channel) video.channel = meta.channel;
    if (meta?.avatarUrl) video.avatarUrl = meta.avatarUrl;
  }

  // Worth-watching gate: for chat destinations (a "prompt" payload), on videos
  // over the threshold whose channel/title isn't trusted, ask for a verdict
  // first. The meta fetch also enriches the prompt's {{channel}}.
  const gateEnabled = gateOverride ?? settings.worthWatchingGate;
  let gateMinutes = 0;
  if (gateEnabled && isPromptDest && !isThumbnail && activeTab?.id !== undefined) {
    const meta = await getVideoMeta(activeTab.id);
    if (meta?.channel) video.channel = meta.channel;
    if (meta?.avatarUrl) video.avatarUrl = meta.avatarUrl;
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

  // Whenever we actually have a transcript, append it to the prompt (treat the
  // destination as non-watching) rather than relying on the AI to open the URL.
  // This covers both the headless REST path and the tab flow (incl. Gemini).
  const promptDest =
    willUseDirectApi || transcript ? { ...destination, canWatch: false } : destination;
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

    const videoId = extractVideoId(url);

    // --- cache check: serve a previous result instantly, skip the API call ---
    const cachedSummary = videoId ? await getCachedSummary(videoId) : null;
    if (cachedSummary && activeTab?.id !== undefined) {
      // Channel comparison still uses fresh history so the ▲/▼/≈ is up-to-date.
      let channelStats: ChannelComparisonStats | undefined;
      if (video.channel) {
        const history = await getHistory();
        const stats = computeChannelStats(history).find((s) => s.channel === video.channel);
        if (stats && stats.count >= 1) {
          channelStats = {
            avgAiRating: stats.avgAiRating,
            avgAudienceScore: stats.avgAudienceScore,
            count: stats.count,
            avgUserRating: stats.avgUserRating,
            userBreakdown: stats.userBreakdown,
          };
        }
      }
      void chrome.tabs
        .sendMessage(activeTab.id, { type: "SET_SUMMARY", tldw: cachedSummary.tldw, source: "cached", channelStats })
        .catch(() => {});
      if (cachedSummary.commentSentiment) {
        void chrome.tabs
          .sendMessage(activeTab.id, {
            type: "SET_COMMENT_SENTIMENT",
            sentiment: cachedSummary.commentSentiment,
            audienceScore: cachedSummary.audienceScore,
          })
          .catch(() => {});
      }
      void flashBadge("✓", true);
      return;
    }

    // --- live call: fetch from Gemini, then write to cache ---
    let responseText: string | undefined;
    let callEntryId: string | undefined;
    let tldw: ReturnType<typeof parseTldwBlock> | undefined;
    let aiRating: number | undefined;
    try {
      responseText = await callGeminiApi(prompt, apiKey!);
      // recordGeminiCall returns the new entry id so we can patch it later.
      callEntryId = await recordGeminiCallReturningId(video, logPrompt, responseText);
      tldw = parseTldwBlock(responseText);

      // Parse the AI rating (e.g. "8/10" → 8) for channel stats storage.
      const aiRatingMatch = tldw?.rating ? /^(\d+)/.exec(tldw.rating) : null;
      aiRating = aiRatingMatch ? parseInt(aiRatingMatch[1], 10) : undefined;

      // Save history BEFORE computing channelStats so this video is included
      // in the channel average from the very first visit. Wrapped in its own
      // try so a storage error never prevents the summary from being shown.
      if (settings.saveHistoryOnSearch) {
        try {
          await addHistoryEntry({
            video, profile, prompt: logPrompt, settings,
            destinationId: destination.id,
            aiRating,
            channelAvatarUrl: video.avatarUrl,
          });
        } catch { /* storage failure: skip history, don't block summary */ }
      }

      // Compute channel comparison from history (now includes this video).
      let channelStats: ChannelComparisonStats | undefined;
      if (video.channel) {
        const history = await getHistory();
        const stats = computeChannelStats(history).find((s) => s.channel === video.channel);
        if (stats && stats.count >= 1) {
          channelStats = {
            avgAiRating: stats.avgAiRating,
            avgAudienceScore: stats.avgAudienceScore,
            count: stats.count,
            avgUserRating: stats.avgUserRating,
            userBreakdown: stats.userBreakdown,
          };
        }
      }

      if (tldw && activeTab?.id !== undefined) {
        void chrome.tabs
          .sendMessage(activeTab.id, { type: "SET_SUMMARY", tldw, source: "Gemini API", channelStats })
          .catch(() => {});

        // Cache the result so future visits to this video skip the API call.
        if (videoId) {
          void setCachedSummary(videoId, { tldw, cachedAt: new Date().toISOString(), channelName: video.channel });
        }

        // Fire the comment sentiment call in parallel (best-effort, never blocks main path).
        if (settings.includeCommentSentiment) {
          void runCommentSentiment(activeTab.id, apiKey!, settings, videoId, callEntryId);
        }
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
    active: forceFocusTab || settings.focusGeminiTab,
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
  // Alt+Shift+G opens the destination tab with the default profile — same as the
  // toolbar/menu, and unaffected by an in-page auto-summary running on Direct API.
  if (command === "ask-gemini") void runSummary(undefined, undefined, undefined, undefined, undefined, undefined, "command");
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "ASK") {
      // Content-script auto-runs omit `source` and default to "auto" (headless
      // when Direct API is on); the popup's Send button passes "popup" so it
      // opens the chosen destination tab like the right-click menu.
      void runSummary(
        message.profileId,
        undefined,
        message.destinationId,
        message.worthWatchingGate,
        message.userCuriosity,
        sender.tab?.id,
        message.source ?? "auto",
      ).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "ASK_COMMENTS") {
      const tabId = sender.tab?.id;
      void (async () => {
        const [settings, activeTab] = await Promise.all([getSettings(), tabId !== undefined ? chrome.tabs.get(tabId) : getActiveTab()]);
        const apiKey = settings.geminiApiKey?.trim();
        if (!apiKey || !settings.useDirectApi) { sendResponse({ ok: false }); return; }
        const url = activeTab?.url ?? "";
        const videoId = url ? extractVideoId(url) : null;
        await runCommentSentiment(tabId ?? activeTab?.id, apiKey, settings, videoId);
        sendResponse({ ok: true });
      })();
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
    if (message.type === "GET_GEMINI_USAGE") {
      void getGeminiUsage().then((usage: GeminiUsage) => sendResponse(usage));
      return true;
    }
    if (message.type === "CLEAR_GEMINI_USAGE") {
      void clearGeminiUsage().then(() => sendResponse({ ok: true }));
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
        await runSummary(undefined, undefined, undefined, undefined, undefined, ytTabId, "popup", true);
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
    if (message.type === "RATE_VIDEO") {
      const { videoId, rating, video } = message;
      void (async () => {
        // Patch the existing history entry; if there's none (summary never saved,
        // or its entry expired), create a lightweight rating-only entry so the
        // rating — and its channel — persist durably in the Channels view.
        const patched = await patchHistoryEntryRating(videoId, rating);
        // When clearing (rating === null) we only strip the rating off an
        // existing entry; we never fabricate a rating-only entry.
        if (!patched && rating !== null) {
          const settings = await getSettings();
          await addRatingOnlyHistoryEntry({ video, rating, settings });
        }
        sendResponse({ ok: true });
      })();
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
