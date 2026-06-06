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
  prompt: string;
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

export type Destination = {
  id: string;
  label: string;
  url: string;
  mode: DestinationMode;
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

/** Message from the popup requesting an "ask Gemini" run. */
export type AskMessage = { type: "ASK"; profileId?: string };

/** Sent from options page after profiles change to sync the context menu. */
export type RebuildMenuMessage = { type: "REBUILD_MENU" };

export type RuntimeMessage = GetPendingMessage | AskMessage | RebuildMenuMessage;
