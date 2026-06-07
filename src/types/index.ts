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
  profileId: string;
  profileName: string;
  /** Destination the search was sent to, so "ask again" reopens the right one. */
  destinationId?: string;
  prompt: string;
  /** Raw text response from the Gemini API — only set for direct-API calls. */
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
};

/** Metadata read from the YouTube page for the worth-watching gate. */
export type VideoMeta = {
  durationSeconds: number;
  channel: string;
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
};

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

export type RuntimeMessage =
  | GetPendingMessage
  | AskMessage
  | RebuildMenuMessage
  | InjectResultMessage
  | AiSummaryMessage;
