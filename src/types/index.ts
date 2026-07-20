export type PromptProfile = {
  id: string;
  name: string;
  description?: string;
  promptTemplate: string;
  isDefault?: boolean;
  isCustomized?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SearchHistoryEntry = {
  id: string;
  videoUrl: string;
  videoTitle?: string;
  /** YouTube channel name — used for per-channel stats. */
  channel?: string;
  /** Channel avatar URL scraped from the YouTube DOM. */
  channelAvatarUrl?: string;
  profileId: string;
  profileName: string;
  /** Destination the search was sent to, so "ask again" reopens the right one. */
  destinationId?: string;
  prompt: string;
  /**
   * Legacy: raw Gemini response. No longer written — the single home for full
   * prompt + response is now the Direct API call log (de-duplicated). Kept on
   * the type so older stored entries still render in the History view.
   */
  apiResponse?: string;
  createdAt: string;
};

/**
 * A destination tab TL;DW opened this browser session. Lives in
 * chrome.storage.session (cleared on browser restart) and is pruned as tabs
 * close, so the popup can offer "jump back to the tab I searched in".
 */
export type OpenSearch = {
  tabId: number;
  /** The YouTube tab that triggered this search, so the popup can reach back to it. */
  sourceTabId?: number;
  /** URL of the source YouTube video, used as a fallback if sourceTabId's tab has closed. */
  videoUrl?: string;
  videoTitle?: string;
  destinationId: string;
  destinationLabel: string;
  createdAt: string;
  /** Original request context used to cache a scraped destination response. */
  cacheContext?: Omit<CachedSummary, "tldw" | "createdAt">;
};

/**
 * Outcome of an auto-fill attempt on a destination page, reported by the
 * injector back to the background. Lives in chrome.storage.session so the popup
 * can surface failures (e.g. a selector that rotted) where the user will see
 * them and know to update them.
 */
export type DeliveryStatus = {
  /** Human label of the site we tried to fill ("ChatGPT", "NotebookLM", …). */
  site: string;
  ok: boolean;
  /** Why it failed, phrased for the popup alert. */
  reason?: string;
  at: string;
  /** What this status is about. "delivery" (default) = an auto-fill attempt. */
  kind?: "delivery";
};

export type HistoryLimit = 50 | 100 | 250 | "unlimited";

export type GeminiKeyValidationFailure =
  | "unauthorized"
  | "model_unavailable"
  | "quota_limited"
  | "google_service"
  | "rejected"
  | "network";

export type GeminiKeyValidation = {
  status: "unverified" | "valid" | "invalid";
  verifiedAt?: string;
  failureCategory?: GeminiKeyValidationFailure;
};

/** Usage stats for direct Gemini API calls. */
export type GeminiUsage = {
  /** Calls since the last manual clear. */
  totalCalls: number;
  /** Permanent all-time total — never reset by clearing usage. */
  allTimeCalls: number;
  /** Calls made on `todayDate` (resets automatically each new day). */
  todayCalls: number;
  /** YYYY-MM-DD of the last call, used to detect day roll-overs. */
  todayDate?: string;
  lastCalledAt?: string;
};

/**
 * A YouTube channel the user has opted into automatic TL;DW summarization for.
 * Stored as an array in chrome.storage.local under "autoRunChannels".
 */
export type AutoRunChannel = {
  /** Href path from the channel link, e.g. "/@PiersMorgan" or "/channel/UCxxxxx". */
  id: string;
  /** Display name shown on the channel page, e.g. "Piers Morgan Uncensored". */
  name: string;
  /** YouTube avatar URL scraped from the watch page (refreshed on each visit). */
  avatarUrl: string;
  /** ISO timestamp when the user added this channel to the auto-run list. */
  addedAt: string;
  /** Auto-fire the AI summary when opening a video from this channel. Defaults true for legacy entries. */
  autoRunSummary: boolean;
};

/**
 * A reusable summary modifier the user attaches to channels (or one-off videos).
 * `prompt` is the instruction woven into the summary prompt (like userCuriosity),
 * so e.g. a "Citations" tag makes the summary surface the video's sources.
 *
 * Assignments live in two maps (see CHANNEL_TAGS_KEY / VIDEO_TAGS_KEY):
 * channel tags auto-apply to every video from that channel; video tags are
 * one-off. "Apply to all future videos of this channel" promotes a video tag
 * into the channel map.
 */
export type Tag = {
  id: string;
  label: string;   // shown on the widget chip + picker, e.g. "Citations"
  prompt: string;  // e.g. "Include the specific sources/citations the video relies on."
};

/** One prompt-aware summary variant stored in the local cache. */
export type CachedSummary = {
  videoId: string;
  promptFingerprint: string;
  tldw: TldwSummary;
  profileId: string;
  profileName: string;
  modelOrDestination: string;
  /** ISO timestamp when this variant was created. */
  createdAt: string;
};

export type SummaryCache = { version: 2; entries: CachedSummary[] };

/** One entry in the Direct API call log — stored per video summarized. */
export type GeminiCallEntry = {
  id: string;
  videoUrl: string;
  videoTitle?: string;
  /** ISO timestamp of the call. */
  at: string;
  /** Transcript-free prompt sent to the API. */
  prompt?: string;
  /** Raw text response from the API. */
  response?: string;
};

/** Age thresholds the history auto-expiry offers (see HISTORY_EXPIRY_OPTIONS). */
export type HistoryExpiryDays = 7 | 30 | 90 | 365;

/**
 * Lifetime usage counters stored under "tldwStats" in chrome.storage.local.
 * Never pruned — survives history expiry and cache clears.
 */
export type LifetimeStats = {
  /** ISO timestamp of the first write. */
  since: string;
  /** Total completed summaries (both Direct API and tab-scrape paths). */
  summaries: number;
  /** Summaries served instantly from cache — zero API wait. */
  cacheHits: number;
  /** Sum of video durations (in seconds) for summarized videos when known. */
  durationSummarizedSeconds: number;
  /** Total SponsorBlock auto-skips recorded. */
  sponsorSkips: number;
  /** Total seconds saved by SponsorBlock auto-skips. */
  sponsorSecondsSaved: number;
  /**
   * Daily summary counts for the summary-activity heatmap.
   * Keys are "YYYY-MM-DD"; capped at the most recent entries (see trimActivity).
   */
  activity: Record<string, number>;
};

/**
 * What gets handed to a destination. "prompt" (default) sends the analysis
 * prompt, with the transcript appended when the destination can't watch the
 * video itself. "source" sends the raw transcript only — for tools like
 * NotebookLM that ingest source material and do their own questioning, where a
 * prompt would be meaningless. "link" sends just the YouTube URL.
 */
export type DestinationPayload = "prompt" | "source" | "link";

export type Destination = {
  id: string;
  label: string;
  url: string;
  payload?: DestinationPayload;
  /**
   * True only for destinations that can open the YouTube URL themselves
   * (Gemini). When false, the transcript is included in the prompt because the
   * destination can't watch the video — independent of how it's delivered.
   */
  canWatch?: boolean;
  /**
   * URL to open when temporary/incognito mode is enabled. If absent, the
   * content script handles the toggle (e.g. clicking the temp-chat button).
   */
  incognitoUrl?: string;
};

export type Settings = {
  defaultProfileId?: string;
  autoSubmit: boolean;
  saveHistoryOnSearch: boolean;
  historyLimit: HistoryLimit;
  /** Auto-delete history entries older than `historyExpiryDays`. */
  autoExpireHistory: boolean;
  /** Age (in days) past which entries are dropped when auto-expire is on. */
  historyExpiryDays: HistoryExpiryDays;
  /** Switch focus to the new destination tab; when false it opens in the background. */
  focusGeminiTab: boolean;
  /** Pause the YouTube video when a summary is sent. */
  autoPauseOnSummarize: boolean;
  /** Which destination a summary is sent to (see DESTINATIONS). */
  destinationId: string;
  /** Open chats in incognito/temporary mode — not saved to the AI's history. */
  temporaryChats: boolean;
  /** Auto-run TL;DW when opening a video longer than this many minutes (0 = off). */
  autoTldwMinutes: number;
  /** Gemini API key for direct (headless) calls — no tab opened when set. */
  geminiApiKey: string;
  /** Display name the user gave this key (e.g. "Personal AI Studio key"). */
  geminiApiKeyName: string;
  /** Validation metadata only. No additional secret material is stored. */
  geminiKeyValidation: GeminiKeyValidation;
  /** Use the direct API path when a key is present (can be toggled off in the popup). */
  useDirectApi: boolean;
  /** Whether the user has acknowledged the first-run privacy notice (SponsorBlock). */
  firstRunNoticeSeen: boolean;
  /** Profile to use for Direct API auto-runs; falls back to the default profile if unset. */
  directApiProfileId?: string;
  /** Auto-skip in-video sponsored segments using the free SponsorBlock community data. */
  skipSponsors: boolean;
  /**
   * Keep the full prompt + raw response in the Direct API call log. Off by
   * default — the log stores only metadata (video, time), since the call COUNT
   * already lives in geminiUsage. Turn on for prompt debugging.
   */
  keepFullCallLog: boolean;
};

export type StorageState = {
  profiles: PromptProfile[];
  history: SearchHistoryEntry[];
  settings: Settings;
};

export type VideoContext = {
  url: string;
  title?: string;
  channel?: string;
  /** Channel id/href (e.g. "/@Handle" or "/channel/UC…") from getChannelInfo().id.
   *  Used to resolve channel tags by id (with name fallback), matching the
   *  widget's writer and the auto-run channel lookups. */
  channelId?: string;
  avatarUrl?: string;
};

/** Metadata read from the YouTube page — channel info, duration (for the
 *  duration-summarized stat and auto-summarize threshold), and avatar. */
export type VideoMeta = {
  durationSeconds: number;
  channel: string;
  /** Channel id/href (getChannelInfo().id) — for channel-tag resolution. */
  channelId?: string;
  avatarUrl?: string;
};

/** Message from the Gemini content script asking for its pending prompt. */
export type GetPendingMessage = { type: "GET_PENDING" };

/**
 * Message from the popup requesting a summary run. `destinationId` lets the
 * popup override the saved default for this one send (a per-session choice that
 * never changes the stored default).
 */
export type AskMessage = {
  type: "ASK";
  profileId?: string;
  destinationId?: string;
  /** Optional one-off question to weave into the prompt for this send. */
  userCuriosity?: string;
  /**
   * Where this send originated, so the worker can decide between the headless
   * Direct API path and opening a destination tab. In-page auto-runs default to
   * "auto" (headless when Direct API is on); the popup's explicit "Send to X"
   * button passes "popup" so it opens that destination like the right-click menu,
   * while the popup's inline-summarize action passes "popup-inline" to run the
   * Direct API headlessly (no tab) like the on-page button.
   */
  source?: SummarySource;
  /** Skip an exact cache match and replace it after a successful run. */
  bypassCache?: boolean;
};

export type CacheLookupMessage = { type: "CACHE_LOOKUP"; videoId: string };
export type CacheClearMessage = { type: "CACHE_CLEAR"; videoId?: string };
export type CacheCountMessage = { type: "CACHE_COUNT" };
export type VerifyGeminiKeyMessage = { type: "VERIFY_GEMINI_KEY" };

/**
 * Entry point that triggered a summarize. The explicit "send to this
 * destination" gestures ("menu", "popup", "command") open the destination tab
 * even when Direct API is on, because the user deliberately asked to send the
 * video. The in-page auto-run ("auto") and the popup's inline action
 * ("popup-inline") run headless when Direct API is on, filling the TL;DW widget
 * in place instead of opening a tab.
 */
export type SummarySource = "menu" | "command" | "popup" | "popup-inline" | "page" | "auto";

/** Sent from options page after profiles change to sync the context menu. */
export type RebuildMenuMessage = { type: "REBUILD_MENU" };

/** Reported by the injector after an auto-fill attempt on a destination page. */
export type InjectResultMessage = {
  type: "INJECT_RESULT";
  site: string;
  ok: boolean;
  reason?: string;
};

/** Compact structured data extracted from the AI response and injected onto the YouTube page. */
export type TldwSummary = {
  /** One sentence stating the video's core conclusion or argument. */
  summary: string;
  /** 1-2 sentences of supporting evidence or key context. */
  details?: string;
};

/**
 * Sent from the inject script once the AI finishes responding. The background
 * forwards it to the source YouTube tab so the summary appears on the page.
 */
export type AiSummaryMessage = {
  type: "AI_SUMMARY";
  tldw: TldwSummary;
  sourceTabId: number;
};

/** Popup/content asking the worker to open the extension's options page.
 *  Optional `section` deep-links to a sidebar section via the page's URL hash. */
export type OpenOptionsMessage = { type: "OPEN_OPTIONS"; section?: string };

/**
 * Content panel's "Open tab" button: focus the destination tab we already
 * scraped for this video if it's still open, otherwise open (and focus) a fresh
 * one. Lets the user jump to the AI tab without spawning duplicates.
 */
export type OpenOrFocusDestinationMessage = { type: "OPEN_OR_FOCUS_DESTINATION" };

/** One sponsor segment from SponsorBlock: a [start, end] time range in seconds. */
export type SponsorSegment = { start: number; end: number; category: string };

/** A sponsor segment as published to the TL;DW panel (with skip/undo state). */
export type SponsorPanelSegment = {
  index: number;
  start: number;
  end: number;
  category: string;
  skipped: boolean;
  disabled: boolean;
  /** True briefly after an auto-skip — the Undo affordance shows only then. */
  undoable: boolean;
};

/**
 * Bridge the SponsorBlock content script (sponsorblock.ts) exposes on `window`
 * so the panel renderer (youtube.ts) — same content-script world — can show the
 * segment timestamps and drive Undo. Changes fire a `tldw-sponsor-update` event.
 */
export type SponsorWindowApi = {
  getSegments: () => SponsorPanelSegment[];
  isEnabled: () => boolean;
  /**
   * Seek to a segment's start or end and take manual control of it (no
   * auto-skip after). Drives the clickable timestamps and the Undo button.
   */
  jumpTo: (index: number, edge: "start" | "end") => void;
};

/** Content script asking the worker to fetch this video's SponsorBlock segments. */
export type GetSponsorSegmentsMessage = { type: "GET_SPONSOR_SEGMENTS"; videoId: string };

/**
 * Fired from sponsorblock.ts each time a segment is auto-skipped, so the
 * background can tally lifetime sponsorSkips + sponsorSecondsSaved stats.
 */
export type SponsorSkippedMessage = {
  type: "SPONSOR_SKIPPED";
  secondsSaved: number;
  category: string;
};

/** Worker's reply with the (possibly empty) list of segments to skip. */
export type SponsorSegmentsResponse = { segments: SponsorSegment[] };

export type RuntimeMessage =
  | GetPendingMessage
  | AskMessage
  | RebuildMenuMessage
  | InjectResultMessage
  | AiSummaryMessage
  | OpenOptionsMessage
  | OpenOrFocusDestinationMessage
  | CacheLookupMessage
  | CacheClearMessage
  | CacheCountMessage
  | VerifyGeminiKeyMessage
  | GetSponsorSegmentsMessage
  | SponsorSkippedMessage;
