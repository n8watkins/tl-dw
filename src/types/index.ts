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
  createdAt: string;
};

/**
 * A destination tab TL;DW opened this browser session. Lives in
 * chrome.storage.session (cleared on browser restart) and is pruned as tabs
 * close, so the popup can offer "jump back to the tab I searched in".
 */
export type OpenSearch = {
  tabId: number;
  videoTitle?: string;
  destinationId: string;
  destinationLabel: string;
  createdAt: string;
};

export type HistoryLimit = 50 | 100 | 250 | "unlimited";

/**
 * Where a summary is sent. "inject" destinations get the prompt typed in
 * automatically by a content script (Gemini); "clipboard" destinations get the
 * prompt copied and the site opened for the user to paste — robust for sites we
 * don't auto-fill (ChatGPT, Claude, NotebookLM, Perplexity).
 */
export type DestinationMode = "inject" | "clipboard";

/**
 * What gets handed to a destination. "prompt" (default) sends the analysis
 * prompt, with the transcript appended for clipboard destinations. "source"
 * sends the raw transcript only — for tools like NotebookLM that ingest source
 * material and do their own questioning, where a prompt would be meaningless.
 */
export type DestinationPayload = "prompt" | "source" | "link";

export type Destination = {
  id: string;
  label: string;
  url: string;
  mode: DestinationMode;
  payload?: DestinationPayload;
  /**
   * True only for destinations that can open the YouTube URL themselves
   * (Gemini). When false, the transcript is included in the prompt because the
   * destination can't watch the video — independent of how it's delivered.
   */
  canWatch?: boolean;
};

export type Settings = {
  defaultProfileId?: string;
  autoSubmit: boolean;
  saveHistoryOnSearch: boolean;
  historyLimit: HistoryLimit;
  geminiUrl: string;
  /** Switch focus to the new Gemini tab; when false it opens in the background. */
  focusGeminiTab: boolean;
  /** Fetch the video's transcript and include it in the prompt when available. */
  includeTranscript: boolean;
  /** Which destination a summary is sent to (see DESTINATIONS). */
  destinationId: string;
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
};

/** Sent from options page after profiles change to sync the context menu. */
export type RebuildMenuMessage = { type: "REBUILD_MENU" };

export type RuntimeMessage = GetPendingMessage | AskMessage | RebuildMenuMessage;
