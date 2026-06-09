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
  /** Raw text response from the Gemini API — only set for direct-API calls. */
  apiResponse?: string;
  /** AI quality score (1-10) parsed from the TL;DW rating field. */
  aiRating?: number;
  /** Audience sentiment score (1-10) from the comment analysis call. */
  audienceScore?: number;
  /**
   * The user's personal verdict on this video. Internal enum is kept as
   * watch/skim/skip (displayed as Engaged/Skimmed/Skipped); numeric map for
   * channel averages is watch=3, skim=2, skip=1 (see USER_RATING_SCALE).
   */
  userRating?: "watch" | "skim" | "skip";
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
  /**
   * What this status is about. "delivery" (default) = an auto-fill attempt;
   * "gate" = the worth-watching verdict's duration read. They're shown
   * separately so a skipped gate doesn't masquerade as a failed delivery.
   */
  kind?: "delivery" | "gate";
};

export type HistoryLimit = 50 | 100 | 250 | "unlimited";

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
 * A YouTube channel the user has blocked from TL;DW injection entirely.
 * Stored as an array in chrome.storage.local under "tldwBlockedChannels".
 */
export type BlockedChannel = {
  id: string;
  name: string;
  avatarUrl: string;
  addedAt: string;
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
  /** Auto-fire the comment analysis when opening a video from this channel. */
  autoRunComments: boolean;
};

/** Cached summary result keyed by video ID in chrome.storage.local. */
export type CachedSummary = {
  tldw: TldwSummary;
  /** ISO timestamp when this entry was written. */
  cachedAt: string;
  /** Community sentiment text, filled in after the comment analysis call. */
  commentSentiment?: string;
  /** Audience score (1–10) from the comment analysis call. */
  audienceScore?: number;
  /** The user's personal verdict on whether the video was worth watching. */
  userRating?: "watch" | "skim" | "skip";
  /** Channel display name — used to clear cached entries when a channel is blocked. */
  channelName?: string;
};

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
  /** Community sentiment summary from the comment analysis call. */
  commentSentiment?: string;
  /** Numeric audience score (1-10) parsed from the comment analysis response. */
  audienceScore?: number;
};

/** Age thresholds the history auto-expiry offers (see HISTORY_EXPIRY_OPTIONS). */
export type HistoryExpiryDays = 7 | 30 | 90 | 365;

/** Minutes thresholds the worth-watching gate offers (see WATCH_THRESHOLD_OPTIONS). */
export type WatchThresholdMinutes = 15 | 20 | 30 | 45 | 60;

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
  geminiUrl: string;
  /** Switch focus to the new destination tab; when false it opens in the background. */
  focusGeminiTab: boolean;
  /** Pause the YouTube video when a summary is sent. */
  autoPauseOnSummarize: boolean;
  /** Ask for a WATCH/SKIM/SKIP verdict first on videos over the threshold. */
  worthWatchingGate: boolean;
  /** Duration (minutes) above which the worth-watching verdict is requested. */
  worthWatchingMinutes: WatchThresholdMinutes;
  /** Channels/keywords (one per line) that bypass the gate — always full summary. */
  gateBypassTerms: string;
  /** Fetch the video's transcript and include it in the prompt when available. */
  includeTranscript: boolean;
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
  /** Use the direct API path when a key is present (can be toggled off in the popup). */
  useDirectApi: boolean;
  /** Profile to use for Direct API auto-runs; falls back to the default profile if unset. */
  directApiProfileId?: string;
  /** Run a second Gemini call to analyze top viewer comments and show community sentiment. */
  includeCommentSentiment: boolean;
  /** Prompt template for the comment sentiment call. Use {{comments}} as the placeholder. */
  commentPromptTemplate: string;
  /** AI dimension — collect/show: render the AI verdict + numeric score pills in the panel. */
  showAiRecommendation: boolean;
  /** AI dimension — track-average: show the per-channel AI rating average + cue. Requires showAiRecommendation. */
  trackAiAverage: boolean;
  /** My dimension — collect/show: render the personal rating buttons (Engaged/Skimmed/Skipped). */
  askForMyRating: boolean;
  /** My dimension — track-average: show the per-channel My rating average + cue. Requires askForMyRating. */
  trackMyAverage: boolean;
  /** Community dimension — track-average: show the per-channel audience score average + cue. Requires includeCommentSentiment. */
  trackCommunityAverage: boolean;
  /** Auto-skip in-video sponsored segments using the free SponsorBlock community data. */
  skipSponsors: boolean;
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
  avatarUrl?: string;
};

/** Metadata read from the YouTube page for the worth-watching gate. */
export type VideoMeta = {
  durationSeconds: number;
  channel: string;
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
  /** Per-send override for the worth-watching verdict gate. */
  worthWatchingGate?: boolean;
  /** Optional one-off question to weave into the prompt for this send. */
  userCuriosity?: string;
  /**
   * Where this send originated, so the worker can decide between the headless
   * Direct API path and opening a destination tab. In-page auto-runs default to
   * "auto" (headless when Direct API is on); the popup's explicit "Send to X"
   * button passes "popup" so it opens that destination like the right-click menu.
   */
  source?: SummarySource;
};

/**
 * Entry point that triggered a summarize. Explicit "send to this destination"
 * gestures ("menu", "popup") open the destination tab even when Direct API is
 * on; the keyboard shortcut and in-page auto-run ("command", "auto") run
 * headless so the TL;DW widget fills in place.
 */
export type SummarySource = "menu" | "command" | "popup" | "auto";

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
  /** WATCH, SKIM, or SKIP */
  verdict: string;
  /** One sentence stating the video's core conclusion or argument. */
  summary: string;
  /** e.g. "8/10" */
  rating: string;
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

/** Sent from background to content script: request the top comments from the page. */
export type GetCommentsMessage = { type: "GET_COMMENTS" };

/** Sent from background to content script: deliver the comment sentiment result. */
export type SetCommentSentimentMessage = {
  type: "SET_COMMENT_SENTIMENT";
  sentiment: string;
  audienceScore?: number;
};

/** Sent from the content script to request a standalone comment-sentiment analysis. */
export type AskCommentsMessage = { type: "ASK_COMMENTS" };

/** Popup requesting the direct-API usage stats; responds with GeminiUsage. */
export type GetGeminiUsageMessage = { type: "GET_GEMINI_USAGE" };

/** Popup asking to reset the direct-API usage counter. */
export type ClearGeminiUsageMessage = { type: "CLEAR_GEMINI_USAGE" };

/** Popup/content asking the worker to open the extension's options page.
 *  Optional `section` deep-links to a sidebar section via the page's URL hash. */
export type OpenOptionsMessage = { type: "OPEN_OPTIONS"; section?: string };

/** Popup asking the content script whether the current channel is blocked. */
export type GetChannelStatusMessage = { type: "GET_CHANNEL_STATUS" };

/**
 * Sent from the content panel when the user picks a personal verdict. The
 * background patches the matching history entry, or — if none exists (the
 * summary was never saved, or its entry expired) — creates a lightweight
 * rating-only history entry so the channel still surfaces in the Channels view.
 */
export type RateVideoMessage = {
  type: "RATE_VIDEO";
  videoId: string;
  /**
   * The chosen verdict, or `null` to CLEAR a previously-set rating (toggle off).
   * When clearing, the background removes `userRating` from the matching history
   * entry and does NOT create a rating-only entry.
   */
  rating: "watch" | "skim" | "skip" | null;
  video: { url: string; title?: string; channel?: string; avatarUrl?: string };
};

/** Response to GET_CHANNEL_STATUS. */
export type ChannelStatusResponse = {
  isBlocked: boolean;
  isCommentsBlocked: boolean;
  channelName: string | null;
};

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
};

/**
 * Bridge the SponsorBlock content script (sponsorblock.ts) exposes on `window`
 * so the panel renderer (youtube.ts) — same content-script world — can show the
 * segment timestamps and drive Undo. Changes fire a `tldw-sponsor-update` event.
 */
export type SponsorWindowApi = {
  getSegments: () => SponsorPanelSegment[];
  isEnabled: () => boolean;
  /** Seek to the segment's start and keep it (don't auto-skip) — "jump & watch". */
  jumpTo: (index: number) => void;
  /** Seek to the segment's end now — manual skip. */
  skipNow: (index: number) => void;
};

/** Content script asking the worker to fetch this video's SponsorBlock segments. */
export type GetSponsorSegmentsMessage = { type: "GET_SPONSOR_SEGMENTS"; videoId: string };

/** Worker's reply with the (possibly empty) list of segments to skip. */
export type SponsorSegmentsResponse = { segments: SponsorSegment[] };

export type RuntimeMessage =
  | GetPendingMessage
  | AskMessage
  | AskCommentsMessage
  | RebuildMenuMessage
  | InjectResultMessage
  | AiSummaryMessage
  | GetCommentsMessage
  | SetCommentSentimentMessage
  | GetGeminiUsageMessage
  | ClearGeminiUsageMessage
  | OpenOptionsMessage
  | RateVideoMessage
  | GetSponsorSegmentsMessage;
