import { buildDestinationPrompt, buildDestinationPromptInfo, promptForHistory } from "../lib/promptBuilder";
import { parseTldwBlock } from "../lib/tldw";
import { selectSummaryProfile } from "../lib/summaryProfile";
import { fingerprintPrompt } from "../lib/summaryCache";
import { verifyGeminiKey } from "../lib/geminiKeyValidation";
import { fallbackNotice, GeminiApiError, normalizeGeminiError, summarizeWithFallback } from "../lib/geminiApi";
import { geminiQuotaDay } from "../lib/geminiUsage";
import {
  API_TOO_LONG_MESSAGE,
  captionsLinkNotice,
  excerptLabel,
  excerptNotice,
  geminiLongNotice,
  noTranscriptLinkNotice,
  NOT_WATCHABLE_MESSAGE,
  planSend,
  publicInfoLabel,
  SIGNED_IN_TRANSCRIPT_LABEL,
  WATCHED_BY_GEMINI_LABEL,
} from "../lib/sendPlan";
import {
  DIRECT_API_MAX_PROMPT_CHARS,
  FALLBACK_GEMINI_MODEL_ID,
  geminiModelLabel,
  GEMINI_URL,
  resolveGeminiModelId,
  extractVideoId,
  GEMINI_DESTINATION,
  isYouTubeShortUrl,
  isYouTubeVideoUrl,
  localDateKey,
  STORAGE_KEYS,
} from "../lib/constants";
import { cacheContextForScrape, findOpenSearchForVideo, shouldCacheScrape, type SetSummaryReply } from "../lib/openSearchMatch";
import { hasSponsorBlockAccess } from "../lib/permissions";
import { cachedSourceLabel } from "../lib/summarySource";
import { fillFailureMessage } from "../lib/fillFailure";
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
  getModelFallback,
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
  setModelFallback,
  setPendingPrompt,
  setSettings,
} from "../lib/storage";
import type { OpenSearch, RuntimeMessage, Settings, SummarySource, VideoContext, VideoMeta } from "../types";

const MENU_ROOT = "tldw-root";

/**
 * Where the menu is offered: the toolbar icon ("action"), a right-click
 * anywhere on a YouTube page ("page"), and a right-click on a video link such
 * as a suggested-video thumbnail ("link"). The page/link entries are scoped to
 * youtube.com so they don't clutter right-clicks elsewhere.
 */
type MenuContext = `${chrome.contextMenus.ContextType}`;
const MENU_CONTEXTS: [MenuContext, ...MenuContext[]] = [
  "action",
  "page",
  "link",
];
const YOUTUBE_DOC_PATTERNS = ["*://*.youtube.com/*"];
// A right-clicked link only offers the menu when it points at a watch page, so
// Shorts thumbnails (and every other YouTube link) don't. Page and toolbar
// right-clicks ignore this; runSummary refuses a Short quietly instead.
const VIDEO_LINK_PATTERNS = ["*://*.youtube.com/watch*"];

/** Rebuild the right-click menu to reflect the current profiles + destination. */
async function rebuildContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();

  const profiles = await getProfiles();
  if (profiles.length === 0) return;

  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: "Summarize with Gemini as...",
    contexts: MENU_CONTEXTS,
    documentUrlPatterns: YOUTUBE_DOC_PATTERNS,
    targetUrlPatterns: VIDEO_LINK_PATTERNS,
  });

  for (const profile of profiles) {
    chrome.contextMenus.create({
      id: profile.id,
      parentId: MENU_ROOT,
      title: profile.name,
      contexts: MENU_CONTEXTS,
      documentUrlPatterns: YOUTUBE_DOC_PATTERNS,
      targetUrlPatterns: VIDEO_LINK_PATTERNS,
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

chrome.runtime.onInstalled.addListener((details) => {
  void ensureSeeded().then(() => rebuildContextMenu());
  void startupStorageSweep();
  // A first install opens the welcome page: what the two modes are and how to
  // get a free Gemini key (or skip and use TL;DW without one).
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${optionsPagePath()}#welcome`) });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void startupStorageSweep();
});

function optionsPagePath(): string {
  return chrome.runtime.getManifest().options_ui?.page ?? "src/options/index.html";
}

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
    void runSummary({ profileId: info.menuItemId as string, linkUrl: info.linkUrl, source: "menu" });
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

const BADGE_COLORS = { error: "#dc2626", ok: "#16a34a", muted: "#6b7280" } as const;

/**
 * Briefly flash the toolbar badge: red for problems, green for success, grey
 * for a quiet "not here" (a keystroke or menu click on a YouTube Short).
 */
async function flashBadge(
  text: string,
  tone: boolean | keyof typeof BADGE_COLORS = false,
): Promise<void> {
  const key = tone === true ? "ok" : tone === false ? "error" : tone;
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[key] });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 2500);
}

/**
 * Ask the YouTube content script for the open video's transcript, if any. The
 * reply names the video the transcript is for; one for any other video than
 * `videoId` (the page moved on mid-request) is refused, so it can never be
 * summarized or cached under the wrong video.
 */
async function getTranscriptFromTab(
  tabId: number,
  videoId: string | null,
): Promise<string | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "GET_TRANSCRIPT",
    })) as { transcript: string | null; videoId?: string | null } | undefined;
    if (!res?.transcript) return null;
    if (res.videoId !== undefined && res.videoId !== videoId) {
      console.warn("[TL;DW] dropped a transcript for", res.videoId, "while summarizing", videoId);
      return null;
    }
    return res.transcript;
  } catch {
    return null;
  }
}

/**
 * How a summary run ended, for the ASK reply: a refusal or failure carries the
 * reason, and can carry a link to where the user can fix it (AI Studio).
 * `noTranscript` marks the refusal to summarize a video whose transcript
 * couldn't be read.
 */
type RunOutcome =
  | { ok: true; notice?: string }
  | {
      ok: false;
      error: string;
      actionUrl?: string;
      noTranscript?: true;
      category?: string;
    };

/**
 * Tell the YouTube page how a run is going ("Reading the transcript…"), and
 * optionally show a notice there (a long video sent as part of its transcript).
 */
function progress(tabId: number, videoId: string | null, step: string, notice?: string): void {
  void chrome.tabs.sendMessage(tabId, {
    type: "SET_RUN_PROGRESS",
    videoId: videoId ?? undefined,
    step,
    notice,
  }).catch(() => {});
}

/** The canonical watch URL for the video in `url`, the form Gemini's video input expects. */
function watchUrl(url: string): string {
  const id = extractVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

// Runs between "send" and the hand-off; while any is preparing (reading the
// page, fetching the transcript) the toolbar badge shows a grey "…".
let preparingRuns = 0;
const PREPARING_BADGE = "…";

async function beginPreparingBadge(): Promise<void> {
  preparingRuns++;
  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.muted });
    await chrome.action.setBadgeText({ text: PREPARING_BADGE });
  } catch { /* cosmetic */ }
}

async function endPreparingBadge(): Promise<void> {
  preparingRuns = Math.max(0, preparingRuns - 1);
  if (preparingRuns > 0) return;
  try {
    // Leave a result badge (✓, !, N/A) that replaced the progress one alone.
    if ((await chrome.action.getBadgeText({})) === PREPARING_BADGE) {
      await chrome.action.setBadgeText({ text: "" });
    }
  } catch { /* cosmetic */ }
}

/** Ask the YouTube content script for the video's title, duration + channel. */
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

/** How long to wait for the page to catch up with the URL after an in-page navigation. */
const META_CATCH_UP_MS = 3000;

/**
 * Page metadata for `videoId`, the video in the tab's URL. Right after an
 * in-page navigation the URL already names the new video while the tab title,
 * heading and channel still show the previous one for up to a second, so poll
 * until the content script reports metadata for this video. Returns null when
 * it never catches up or no content script answers (a tab opened before the
 * extension loaded).
 */
async function readCurrentVideoMeta(
  tabId: number,
  videoId: string | null,
): Promise<VideoMeta | null> {
  if (!videoId) return null;
  const deadline = Date.now() + META_CATCH_UP_MS;
  for (;;) {
    const meta = await getVideoMeta(tabId);
    if (!meta) return null;
    if (meta.current && meta.videoId === videoId) return meta;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Verify the saved key with a metadata read of the chosen model. This is not
 * an inference request. With `enableOnSuccess` (a key just saved), a verified
 * key turns Direct API mode on.
 */
async function verifySavedGeminiKey(enableOnSuccess = false) {
  const before = await getSettings();
  const apiKey = before.geminiApiKey.trim();
  if (!apiKey) return { ok: false, validation: { status: "unverified" as const } };

  const validation = await verifyGeminiKey(apiKey, fetch, new Date(), resolveGeminiModelId(before.geminiModelId));

  const current = await getSettings();
  if (current.geminiApiKey === before.geminiApiKey) {
    await setSettings({
      ...current,
      geminiKeyValidation: validation,
      ...(enableOnSuccess && validation.status === "valid" ? { useDirectApi: true } : {}),
    });
  }
  return { ok: validation.status === "valid", validation };
}

/**
 * The core motion: read the target YouTube video, build the prompt from the
 * chosen (or default) profile, then open the destination tab and hand the
 * prompt to its injector to auto-fill and submit.
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
type RunOptions = {
  profileId?: string;
  linkUrl?: string;
  userCuriosity?: string;
  senderTabId?: number;
  source?: SummarySource;
  forceFocusTab?: boolean;
  bypassCache?: boolean;
};

async function runSummary(opts: RunOptions = {}): Promise<RunOutcome> {
  await beginPreparingBadge();
  try {
    return await prepareAndSend(opts);
  } finally {
    await endPreparingBadge();
  }
}

async function prepareAndSend({
  profileId,
  linkUrl,
  userCuriosity,
  senderTabId,
  source = "auto",
  forceFocusTab = false,
  bypassCache = false,
}: RunOptions): Promise<RunOutcome> {
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

  const url = isThumbnail ? linkUrl : activeTab?.url;

  // TL;DW does not run on Shorts: no transcript read, no tab, no panel. A quiet
  // grey badge acknowledges the keystroke or menu click instead of an error.
  if (!isThumbnail && isYouTubeShortUrl(url)) {
    await flashBadge("N/A", "muted");
    return { ok: false, error: "TL;DW doesn't run on YouTube Shorts." };
  }

  if (!url || !isYouTubeVideoUrl(url)) {
    await flashBadge("!");
    return { ok: false, error: "Open a YouTube video first." };
  }

  // Title and channel come from the page, read once it shows the video in the
  // URL (the tab title lags an in-page navigation). A thumbnail has neither.
  let title: string | undefined;
  let meta: VideoMeta | null = null;
  if (!isThumbnail && activeTab?.id !== undefined) {
    meta = await readCurrentVideoMeta(activeTab.id, extractVideoId(url));
    // A broadcast that is live right now has no transcript yet: nothing to send.
    if (meta?.live) {
      await flashBadge("N/A", "muted");
      return {
        ok: false,
        error: "this is a live stream. TL;DW can summarize it once the broadcast ends.",
      };
    }
    if (meta?.unavailable) {
      await flashBadge("N/A", "muted");
      return { ok: false, error: "YouTube can't play this video here, so there's nothing to summarize." };
    }
    if (meta?.title) {
      title = meta.title;
    } else {
      // No answer from the page: by now the tab title has caught up, so re-read it.
      const fresh = await chrome.tabs.get(activeTab.id).catch(() => activeTab);
      title = cleanTitle(fresh?.title);
    }
  }

  const [settings, profiles] = await Promise.all([getSettings(), getProfiles()]);
  const destination = GEMINI_DESTINATION;
  const video: VideoContext = { url, title };

  // Pause the video you're on (not a suggested thumbnail) before we hand off.
  if (settings.autoPauseOnSummarize && !isThumbnail && activeTab?.id !== undefined) {
    void chrome.tabs.sendMessage(activeTab.id, { type: "PAUSE_VIDEO" }).catch(() => {});
  }

  const isPromptDest = true;
  const videoId = extractVideoId(url);
  const pageTabId = !isThumbnail ? activeTab?.id : undefined;
  // Explicit "open this destination" gestures (the right-click menu, the popup's
  // Send button, the keyboard shortcut, and the on-page panel's "send to a tab"
  // buttons) always open the destination tab with the chosen (or default)
  // profile. The Direct API applies to the in-page run and auto-runs and the
  // popup's inline action, which fill the TL;DW panel in place.
  const opensTab = source === "menu" || source === "popup" || source === "command" || source === "page-tab";
  const apiKey = settings.geminiApiKey?.trim();
  const hasApi = !!(apiKey && settings.useDirectApi);
  const willUseDirectApi = hasApi && isPromptDest && !opensTab;
  const profile = selectSummaryProfile(profiles, settings, source, profileId, willUseDirectApi);
  if (!profile) {
    await flashBadge("!");
    return { ok: false, error: "there's no prompt profile. Add one in TL;DW's options." };
  }

  if (pageTabId !== undefined && isPromptDest) {
    progress(pageTabId, videoId, "Reading the transcript…");
  }

  // Read the transcript for every prompt and source destination: TL;DW decides
  // up front, from the transcript and its length, how the video is sent.
  let transcript: string | null = null;
  if (pageTabId !== undefined) {
    transcript = await getTranscriptFromTab(pageTabId, videoId);
  }

  // Video metadata (read once above) feeds channel-tracking stats, the
  // duration-summarized stat, AND tag resolution on EVERY prompt path (not just
  // Direct-API), so channel tags resolve even on the plain tab-flow.
  let videoDurationSeconds = 0;
  if (isPromptDest && meta) {
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
    videoId: videoId ?? undefined,
  });

  // The prompt with the whole transcript, within the API's budget or the site's
  // message limit. `truncated` says it didn't fit.
  const transcriptDest = { ...destination, canWatch: false };
  const full = buildDestinationPromptInfo(
    profile, video, transcriptDest, transcript, userCuriosity, activeTags,
    willUseDirectApi ? { maxChars: DIRECT_API_MAX_PROMPT_CHARS } : {},
  );
  const plan = planSend({
    useApi: willUseDirectApi,
    hasTranscript: !!transcript,
    transcriptFits: !!transcript && !full.truncated,
  });
  // The prompt without a transcript: for the call log and history, and what a
  // destination that watches the video itself gets.
  const linkPrompt = buildDestinationPrompt(
    profile, video, { ...destination, canWatch: true }, null, userCuriosity, activeTags,
  );

  // --- longer than even the API takes (about 17 hours of speech) ----------
  if (plan === "api-too-long") {
    await flashBadge("N/A", "muted");
    if (pageTabId !== undefined) {
      void chrome.tabs.sendMessage(pageTabId, {
        type: "SET_SUMMARY_ERROR",
        videoId: videoId ?? undefined,
        reason: API_TOO_LONG_MESSAGE,
        decision: true,
      }).catch(() => {});
    }
    return { ok: false, error: API_TOO_LONG_MESSAGE };
  }

  // --- headless path: call Gemini API directly (no tab) -------------------
  if (willUseDirectApi) {
    const watch = plan === "api-video";
    if (watch && meta?.watchable === false) {
      await flashBadge("N/A", "muted");
      if (pageTabId !== undefined) {
        void chrome.tabs.sendMessage(pageTabId, {
          type: "SET_SUMMARY_ERROR", videoId: videoId ?? undefined, reason: NOT_WATCHABLE_MESSAGE, noTranscript: true,
        }).catch(() => {});
      }
      return { ok: false, error: NOT_WATCHABLE_MESSAGE, noTranscript: true };
    }
    const prompt = watch ? linkPrompt : full.prompt;
    const model = resolveGeminiModelId(settings.geminiModelId);
    const promptFingerprint = await fingerprintPrompt(prompt, watch ? `${model}:video` : model);

    // --- cache check: serve a previous result instantly, skip the API call ---
    const cachedSummary = videoId && !bypassCache
      ? await getCachedSummary(videoId, promptFingerprint)
      : null;
    if (cachedSummary && activeTab?.id !== undefined) {
      void chrome.tabs
        .sendMessage(activeTab.id, {
          type: "SET_SUMMARY",
          tldw: cachedSummary.tldw,
          source: cachedSourceLabel(cachedSummary.profileName),
          sourceKind: "cache",
          videoId,
        })
        .catch(() => {});
      // Bump lifetime stats: cache hit.
      void bumpLifetimeStats((s) => { s.cacheHits += 1; });
      void flashBadge("✓", true);
      return { ok: true };
    }

    if (pageTabId !== undefined) {
      progress(pageTabId, videoId, watch
        ? "Gemini is watching the video (no transcript). This can take a minute…"
        : `Asking ${geminiModelLabel(model)}…`);
    }

    // --- live call: fetch from Gemini, then write to cache ---
    let responseText: string | undefined;
    let tldw: ReturnType<typeof parseTldwBlock> | undefined;
    let callId: string | undefined;
    try {
      callId = await beginGeminiCall(video, prompt, profile);
      const fallback = await getModelFallback();
      const result = await summarizeWithFallback(
        watch ? { prompt, videoUrl: watchUrl(url) } : { prompt },
        apiKey!,
        model,
        {
          skipDefault: fallback.dailyLimitDay === geminiQuotaDay(),
          onFallback: async (limitError) => {
            if (limitError.dailyQuota) await setModelFallback({ ...fallback, dailyLimitDay: geminiQuotaDay() });
            if (pageTabId !== undefined) {
              progress(pageTabId, videoId, `Asking ${geminiModelLabel(FALLBACK_GEMINI_MODEL_ID)}…`);
            }
          },
        },
      );
      responseText = result.text;
      tldw = parseTldwBlock(responseText);
      if (!tldw) {
        throw new GeminiApiError("malformed_response");
      }
      if (watch) tldw = { ...tldw, label: WATCHED_BY_GEMINI_LABEL };
      await finishGeminiCall(callId, "success", { response: responseText });
      // Tell the user once per quota day that a fallback model answered.
      let note: string | undefined;
      if (result.fellBackFrom) {
        const day = geminiQuotaDay();
        const state = await getModelFallback();
        if (state.notifiedDay !== day) {
          note = fallbackNotice(result.fellBackFrom, result.model);
          await setModelFallback({ ...state, notifiedDay: day });
        }
      }

      // Save history. Wrapped in its own try so a storage error never prevents
      // the summary from being shown.
      if (settings.saveHistoryOnSearch) {
        try {
          await addHistoryEntry({
            video, profile, prompt: promptForHistory(prompt), settings,
            destinationId: destination.id,
            channelAvatarUrl: video.avatarUrl,
          });
        } catch { /* storage failure: skip history, don't block summary */ }
      }

      if (activeTab?.id !== undefined) {
        void chrome.tabs
          .sendMessage(activeTab.id, {
            type: "SET_SUMMARY",
            tldw,
            source: geminiModelLabel(result.model),
            sourceKind: "api",
            videoId,
            note,
          })
          .catch(() => {});

        // Cache the result so future visits to this video skip the API call.
        if (videoId) {
          void setCachedSummary({
            videoId,
            promptFingerprint,
            tldw,
            profileId: profile.id,
            profileName: profile.name,
            modelOrDestination: result.model,
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
      // Surface the failure on the page so the run ends at once with the real
      // reason and the action that fixes it, not after the long timeout.
      if (activeTab?.id !== undefined) {
        void chrome.tabs
          .sendMessage(activeTab.id, {
            type: "SET_SUMMARY_ERROR",
            videoId,
            reason,
            actionUrl: apiError.actionUrl,
            category: apiError.category,
          })
          .catch(() => {});
      }
      // The reply carries the link too: whichever of the two reaches the page
      // first ends the run, and the error panel must keep its link either way.
      return { ok: false, error: reason, actionUrl: apiError.actionUrl, category: apiError.category };
    }
    return { ok: true };
  }

  // --- tab path: open the destination and let its injector fill it ---------
  // A summary made from less than the whole transcript says so on the panel:
  // TL;DW never cuts a transcript, or leaves it out, silently.
  let prompt: string;
  let notice: string | undefined;
  let summaryLabel: string | undefined;
  // Signed in, the Gemini web app reads a video's captions from its link, so a
  // long or unread-but-captioned video gets that prompt too; the injector
  // sends it only once the page shows a signed-in account.
  const signedInVariant = destination.id === "gemini" &&
    (plan === "tab-excerpt" || (plan === "tab-link" && meta?.hasCaptions === true));
  const signedInPrompt = signedInVariant
    ? buildDestinationPromptInfo(profile, video, { ...destination, canWatch: true }, null, userCuriosity, activeTags, {
        linkMode: "transcript",
      }).prompt
    : undefined;
  if (plan === "tab-transcript" || plan === "tab-excerpt") {
    prompt = full.prompt;
    if (plan === "tab-excerpt") {
      notice = signedInVariant ? geminiLongNotice(hasApi) : excerptNotice(destination.label, hasApi);
      summaryLabel = excerptLabel(hasApi);
    }
  } else {
    prompt = linkPrompt;
    notice = signedInVariant ? captionsLinkNotice(hasApi) : noTranscriptLinkNotice(hasApi);
    summaryLabel = publicInfoLabel(hasApi);
  }

  const tabVideoId = videoId;
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
      source: cachedSourceLabel(tabCachedSummary.profileName),
      sourceKind: "cache",
      videoId: tabVideoId,
    }).catch(() => {});
    void bumpLifetimeStats((stats) => { stats.cacheHits += 1; });
    void flashBadge("✓", true);
    return { ok: true };
  }


  if (pageTabId !== undefined && isPromptDest) {
    progress(pageTabId, videoId, `Waiting for ${destination.label}'s answer in its tab…`, notice);
  }

  // Open the Gemini tab and hand its injector the prompt to auto-fill. Gemini
  // has no temporary-chat URL: the injector clicks its button instead.
  const targetUrl = GEMINI_URL;
  // Sends started on the YouTube page (its button, its panel, an auto-run) open
  // the tab in the background, so the video keeps the focus.
  const fromPage = source === "page" || source === "auto" || source === "page-tab";
  const injectTab = await chrome.tabs.create({
    url: targetUrl,
    active: forceFocusTab || (!fromPage && settings.focusGeminiTab),
  });
  if (injectTab.id !== undefined) {
    await setPendingPrompt(injectTab.id, { prompt, signedInPrompt, sourceTabId: activeTab?.id });
    await recordOpenSearch(
      injectTab.id,
      video,
      destination,
      activeTab?.id,
      plan === "tab-transcript" || plan === "tab-excerpt" ? (tabVideoId ?? undefined) : undefined,
      tabVideoId && tabPromptFingerprint
        ? {
            videoId: tabVideoId,
            promptFingerprint: tabPromptFingerprint,
            profileId: profile.id,
            profileName: profile.name,
            modelOrDestination: destination.id,
          }
        : undefined,
      summaryLabel,
      signedInPrompt ? SIGNED_IN_TRANSCRIPT_LABEL : undefined,
      videoDurationSeconds,
    );
  }
  if (settings.saveHistoryOnSearch) {
    // Store the prompt that was sent, with the transcript replaced by a
    // placeholder: the transcript can be tens to hundreds of KB, and persisting
    // it per entry would bloat chrome.storage.local toward its ~5 MB quota (and
    // "Copy prompt" shouldn't quietly drag the whole transcript along). A
    // source destination gets the bare transcript, so it is replaced whole.
    await addHistoryEntry({
      video,
      profile,
      prompt: promptForHistory(prompt),
      settings,
      destinationId: destination.id,
      channelAvatarUrl: video.avatarUrl,
    });
  }
  return { ok: true, notice };
}

/** Remember a destination tab we opened, so the popup can offer "jump back". */
async function recordOpenSearch(
  tabId: number,
  video: VideoContext,
  destination: { id: string; label: string },
  sourceTabId?: number,
  transcriptVideoId?: string,
  cacheContext?: import("../types").OpenSearch["cacheContext"],
  summaryLabel?: string,
  signedInLabel?: string,
  videoDurationSeconds?: number,
): Promise<void> {
  await addOpenSearch({
    summaryLabel,
    signedInLabel,
    videoDurationSeconds: videoDurationSeconds || undefined,
    tabId,
    sourceTabId,
    transcriptVideoId,
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
  if (command === "ask-gemini") void runSummary({ source: "command" });
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "ASK") {
      // Content-script auto-runs omit `source` and default to "auto" (headless
      // when Direct API is on); the popup's Send button passes "popup" so it
      // opens the chosen destination tab like the right-click menu, and the
      // popup's inline action passes "popup-inline" to run headless (no tab).
      void runSummary({
        profileId: message.profileId,
        userCuriosity: message.userCuriosity,
        senderTabId: message.sourceTabId ?? sender.tab?.id,
        source: message.source ?? "auto",
        bypassCache: message.bypassCache ?? false,
      }).then(
        (outcome) => sendResponse(outcome),
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
      // A failed fill ends the run on the YouTube page now, with the reason,
      // instead of leaving its button on "Analyzing..." until the 90s timeout.
      if (!message.ok && sender.tab?.id !== undefined) {
        const destTabId = sender.tab.id;
        void (async () => {
          const search = (await getOpenSearches()).find((s) => s.tabId === destTabId);
          if (search?.sourceTabId === undefined) return;
          const videoId = search.videoUrl ? extractVideoId(search.videoUrl) ?? undefined : undefined;
          const reason = fillFailureMessage({
            site: message.site,
            reason: message.reason,
            keptPercent: message.keptPercent,
            copied: message.copied,
          });
          await chrome.tabs.sendMessage(search.sourceTabId, { type: "SET_SUMMARY_ERROR", videoId, reason });
        })().catch(() => {});
      }
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
      let tldw = message.tldw;
      void (async () => {
        let videoId: string | undefined;
        let match: OpenSearch | undefined;
        let durSec = 0;
        try {
          const searches = await getOpenSearches();
          // Only this tab's own request says which video the answer is for.
          // (Falling back to any search from the same YouTube tab could name
          // the video that tab plays NOW, putting an old answer on a new video.)
          const ownSearch = searches.find((s) => destTabId !== undefined && s.tabId === destTabId);
          match = ownSearch;
          // Count the length only of the video this tab's own request was for.
          durSec = ownSearch?.videoDurationSeconds ?? 0;
          if (match?.videoUrl) videoId = extractVideoId(match.videoUrl) ?? undefined;
          // Cache only a scrape we can tie to its own request (this destination
          // tab), and never one whose prompt carried another video's transcript.
          const label = message.signedIn && ownSearch?.signedInLabel ? ownSearch.signedInLabel : match?.summaryLabel;
          if (label) tldw = { ...tldw, label };
        } catch { /* best effort */ }
        // An answer TL;DW can't tie to a video is never shown: the page shows
        // only a summary that names the video it is for.
        if (!videoId) return;
        const reply = (await chrome.tabs
          .sendMessage(srcTabId, {
            type: "SET_SUMMARY",
            tldw,
            source: match?.destinationLabel,
            sourceKind: "tab",
            videoId,
          })
          .catch(() => undefined)) as SetSummaryReply | undefined;
        // Cache only what the page showed for its own video and wasn't late
        // for, and only a real parsed summary from this tab's own request.
        try {
          const cacheContext = shouldCacheScrape(message.parsed, reply) ? cacheContextForScrape(match?.tabId === destTabId ? match : undefined) : undefined;
          if (cacheContext) {
            await setCachedSummary({ ...cacheContext, tldw, createdAt: new Date().toISOString() });
          }
        } catch { /* best effort: a failed cache write never hides the summary */ }
        // Bump lifetime stats: summary completed (tab-scrape / AI_SUMMARY path).
        // The video's length was recorded with the tab TL;DW opened for it.
        const today = localDateKey();
        void bumpLifetimeStats((s) => {
          s.summaries += 1;
          s.activity[today] = (s.activity[today] ?? 0) + 1;
          if (durSec > 0) s.durationSummarizedSeconds += durSec;
        });
      })();
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
          // SponsorBlock is opt-in: without the user's permission nothing is sent.
          if (!(await hasSponsorBlockAccess())) {
            sendResponse({ segments: [] });
            return;
          }
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
      void verifySavedGeminiKey(message.enableOnSuccess ?? false).then(sendResponse);
      return true;
    }
    if (message.type === "OPEN_OR_FOCUS_DESTINATION") {
      const ytTabId = sender.tab?.id;
      const ytUrl = sender.tab?.url;
      void (async () => {
        // Reuse the destination tab we already scraped for THIS video if it's
        // still open: focus it instead of spawning a duplicate. Match on the
        // video id, never on the YouTube tab alone, which may have sent other
        // videos before an in-page navigation.
        const searches = await getOpenSearches(); // prunes closed tabs
        const ytVideoId = message.videoId ?? (ytUrl ? extractVideoId(ytUrl) : null);
        const match = findOpenSearchForVideo(searches, ytVideoId, ytTabId);
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
        await runSummary({ senderTabId: ytTabId, source: "popup", forceFocusTab: true });
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
        // Found through runtime contexts, which needs no "tabs" permission.
        const base = chrome.runtime.getURL(optionsPagePath());
        const url = `${base}#${section}`;
        void (async () => {
          const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] })
            .catch(() => [] as chrome.runtime.ExtensionContext[]);
          const existing = contexts.find((c) => c.documentUrl?.startsWith(base) && c.tabId >= 0);
          if (existing) {
            const tab = await chrome.tabs.update(existing.tabId, { url, active: true });
            if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
          } else {
            await chrome.tabs.create({ url });
          }
        })().catch(() => {});
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
            signedInPrompt: pending?.signedInPrompt,
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
