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

export type Settings = {
  defaultProfileId?: string;
  autoSubmit: boolean;
  saveHistoryOnSearch: boolean;
  historyLimit: HistoryLimit;
  geminiUrl: string;
  /** Switch focus to the new Gemini tab; when false it opens in the background. */
  focusGeminiTab: boolean;
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
