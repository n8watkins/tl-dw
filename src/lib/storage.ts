import type {
  AutoRunChannel,
  CachedSummary,
  DeliveryStatus,
  GeminiCallEntry,
  GeminiUsage,
  OpenSearch,
  PromptProfile,
  SearchHistoryEntry,
  Settings,
  StorageState,
} from "../types";
import {
  AUTO_RUN_CHANNELS_KEY,
  CACHE_TTL_MS,
  DEFAULT_SETTINGS,
  DELIVERY_STATUS_KEY,
  GEMINI_CALL_LOG_KEY,
  GEMINI_USAGE_KEY,
  OPEN_SEARCHES_KEY,
  PENDING_KEY,
  STORAGE_KEYS,
  SUMMARY_CACHE_KEY,
} from "./constants";
import { createDefaultProfiles } from "./profiles";

function normalizeBuiltInProfiles(profiles: PromptProfile[]): PromptProfile[] {
  const builtInIds = new Set(createDefaultProfiles().map((profile) => profile.id));
  return profiles.map((profile) =>
    builtInIds.has(profile.id) ? { ...profile, isDefault: true } : profile,
  );
}

export async function getProfiles(): Promise<PromptProfile[]> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.profiles);
  return normalizeBuiltInProfiles((r[STORAGE_KEYS.profiles] as PromptProfile[]) ?? []);
}

export async function setProfiles(profiles: PromptProfile[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.profiles]: profiles });
}

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(r[STORAGE_KEYS.settings] as Settings) };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function getHistory(): Promise<SearchHistoryEntry[]> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.history);
  return (r[STORAGE_KEYS.history] as SearchHistoryEntry[]) ?? [];
}

export async function setHistory(history: SearchHistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: history });
}

export async function getState(): Promise<StorageState> {
  const [profiles, history, settings] = await Promise.all([
    getProfiles(),
    getHistory(),
    getSettings(),
  ]);
  return { profiles, history, settings };
}

/** Seed defaults on first install without clobbering existing data. */
export async function ensureSeeded(): Promise<void> {
  const profiles = await getProfiles();
  if (profiles.length === 0) {
    const defaults = createDefaultProfiles();
    await setProfiles(defaults);
    const settings = await getSettings();
    if (!settings.defaultProfileId) {
      await setSettings({
        ...settings,
        defaultProfileId: defaults.find((p) => p.isDefault)?.id ?? defaults[0].id,
      });
    }
  }
}

export async function resolveProfile(
  profileId?: string,
): Promise<PromptProfile | undefined> {
  const [profiles, settings] = await Promise.all([getProfiles(), getSettings()]);
  const id = profileId ?? settings.defaultProfileId;
  return profiles.find((p) => p.id === id) ?? profiles[0];
}

// --- session-scoped prompt handoff, keyed by the destination tab id ---

export type PendingData = {
  prompt: string;
  /** YouTube tab to send the AI response back to, if triggered from one. */
  sourceTabId?: number;
};

export async function setPendingPrompt(
  tabId: number,
  data: PendingData,
): Promise<void> {
  const r = await chrome.storage.session.get(PENDING_KEY);
  const pending = (r[PENDING_KEY] as Record<number, PendingData>) ?? {};
  pending[tabId] = data;
  await chrome.storage.session.set({ [PENDING_KEY]: pending });
}

export async function takePendingPrompt(
  tabId: number,
): Promise<PendingData | undefined> {
  const r = await chrome.storage.session.get(PENDING_KEY);
  const pending = (r[PENDING_KEY] as Record<number, PendingData | string>) ?? {};
  const raw = pending[tabId];
  if (raw !== undefined) {
    delete pending[tabId];
    await chrome.storage.session.set({ [PENDING_KEY]: pending });
  }
  if (typeof raw === "string") return { prompt: raw }; // backward-compat
  return raw as PendingData | undefined;
}

// --- session-scoped list of open destination tabs ---

async function readOpenSearches(): Promise<OpenSearch[]> {
  const r = await chrome.storage.session.get(OPEN_SEARCHES_KEY);
  return (r[OPEN_SEARCHES_KEY] as OpenSearch[]) ?? [];
}

/** Record a destination tab we just opened (newest first, deduped, capped). */
export async function addOpenSearch(entry: OpenSearch): Promise<void> {
  const existing = (await readOpenSearches()).filter(
    (s) => s.tabId !== entry.tabId,
  );
  const next = [entry, ...existing].slice(0, 20);
  await chrome.storage.session.set({ [OPEN_SEARCHES_KEY]: next });
}

/** Drop a search entry when its tab closes. */
export async function pruneOpenSearch(tabId: number): Promise<void> {
  const existing = await readOpenSearches();
  const next = existing.filter((s) => s.tabId !== tabId);
  if (next.length !== existing.length) {
    await chrome.storage.session.set({ [OPEN_SEARCHES_KEY]: next });
  }
}

// --- session-scoped record of recent auto-fill outcomes ---

/** Record an auto-fill outcome (newest first, capped) for the popup to show. */
export async function recordDeliveryStatus(status: DeliveryStatus): Promise<void> {
  const r = await chrome.storage.session.get(DELIVERY_STATUS_KEY);
  const list = (r[DELIVERY_STATUS_KEY] as DeliveryStatus[]) ?? [];
  const next = [status, ...list].slice(0, 10);
  await chrome.storage.session.set({ [DELIVERY_STATUS_KEY]: next });
}

export async function getDeliveryStatuses(): Promise<DeliveryStatus[]> {
  const r = await chrome.storage.session.get(DELIVERY_STATUS_KEY);
  return (r[DELIVERY_STATUS_KEY] as DeliveryStatus[]) ?? [];
}

export async function clearDeliveryStatuses(): Promise<void> {
  await chrome.storage.session.remove(DELIVERY_STATUS_KEY);
}

// --- Gemini API usage stats and call log -----------------------------------

const CALL_LOG_LIMIT = 200;

function emptyUsage(): GeminiUsage {
  return { totalCalls: 0, allTimeCalls: 0, todayCalls: 0 };
}

export async function getGeminiUsage(): Promise<GeminiUsage> {
  const r = await chrome.storage.local.get(GEMINI_USAGE_KEY);
  const stored = r[GEMINI_USAGE_KEY] as Partial<GeminiUsage> | undefined;
  return { ...emptyUsage(), ...stored };
}

/**
 * Core implementation: writes a Gemini call log entry + updates usage stats.
 * Returns the new entry's id so callers can patch it later (e.g. with comment sentiment).
 */
async function _recordGeminiCall(
  video?: { url: string; title?: string },
  prompt?: string,
  response?: string,
  commentSentiment?: string,
  audienceScore?: number,
): Promise<string> {
  const [usage, logRaw] = await Promise.all([
    getGeminiUsage(),
    chrome.storage.local.get(GEMINI_CALL_LOG_KEY),
  ]);

  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);
  const isSameDay = usage.todayDate === todayDate;

  const updatedUsage: GeminiUsage = {
    totalCalls: usage.totalCalls + 1,
    allTimeCalls: usage.allTimeCalls + 1,
    todayCalls: isSameDay ? usage.todayCalls + 1 : 1,
    todayDate,
    lastCalledAt: now.toISOString(),
  };

  const existingLog = (logRaw[GEMINI_CALL_LOG_KEY] as GeminiCallEntry[]) ?? [];
  const id = crypto.randomUUID();
  const newEntry: GeminiCallEntry = {
    id,
    videoUrl: video?.url ?? "",
    videoTitle: video?.title,
    at: now.toISOString(),
    prompt,
    response,
    commentSentiment,
    audienceScore,
  };
  const updatedLog = [newEntry, ...existingLog].slice(0, CALL_LOG_LIMIT);

  await chrome.storage.local.set({
    [GEMINI_USAGE_KEY]: updatedUsage,
    [GEMINI_CALL_LOG_KEY]: updatedLog,
  });

  return id;
}

export async function recordGeminiCall(
  video?: { url: string; title?: string },
  prompt?: string,
  response?: string,
): Promise<void> {
  await _recordGeminiCall(video, prompt, response);
}

/**
 * Like `recordGeminiCall` but returns the new entry id so the caller can patch
 * it later (e.g. after a parallel comment sentiment call completes).
 */
export async function recordGeminiCallReturningId(
  video?: { url: string; title?: string },
  prompt?: string,
  response?: string,
): Promise<string> {
  return _recordGeminiCall(video, prompt, response);
}

/**
 * Patch an existing call log entry with comment sentiment data after the fact.
 * No-op if no entry with `id` is found.
 */
export async function patchGeminiCallEntry(
  id: string,
  patch: { commentSentiment?: string; audienceScore?: number },
): Promise<void> {
  const logRaw = await chrome.storage.local.get(GEMINI_CALL_LOG_KEY);
  const log = (logRaw[GEMINI_CALL_LOG_KEY] as GeminiCallEntry[]) ?? [];
  const updated = log.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await chrome.storage.local.set({ [GEMINI_CALL_LOG_KEY]: updated });
}

/** Clears stats (totalCalls, todayCalls, lastCalledAt) but keeps allTimeCalls. */
export async function clearGeminiUsage(): Promise<void> {
  const usage = await getGeminiUsage();
  await chrome.storage.local.set({
    [GEMINI_USAGE_KEY]: {
      ...emptyUsage(),
      allTimeCalls: usage.allTimeCalls,
    } satisfies GeminiUsage,
  });
}

export async function getGeminiCallLog(): Promise<GeminiCallEntry[]> {
  const r = await chrome.storage.local.get(GEMINI_CALL_LOG_KEY);
  return (r[GEMINI_CALL_LOG_KEY] as GeminiCallEntry[]) ?? [];
}

export async function clearGeminiCallLog(): Promise<void> {
  await chrome.storage.local.remove(GEMINI_CALL_LOG_KEY);
}

// --- Summary result cache -------------------------------------------------

type SummaryCache = Record<string, CachedSummary>;

export async function getCachedSummary(videoId: string): Promise<CachedSummary | null> {
  const r = await chrome.storage.local.get(SUMMARY_CACHE_KEY);
  const cache = (r[SUMMARY_CACHE_KEY] as SummaryCache) ?? {};
  const entry = cache[videoId];
  if (!entry) return null;
  if (Date.now() - new Date(entry.cachedAt).getTime() > CACHE_TTL_MS) return null;
  return entry;
}

export async function setCachedSummary(videoId: string, entry: CachedSummary): Promise<void> {
  const r = await chrome.storage.local.get(SUMMARY_CACHE_KEY);
  const cache = (r[SUMMARY_CACHE_KEY] as SummaryCache) ?? {};
  cache[videoId] = entry;
  // Prune stale entries on every write to bound storage growth.
  const now = Date.now();
  for (const id of Object.keys(cache)) {
    const e = cache[id]!;
    if (now - new Date(e.cachedAt).getTime() > CACHE_TTL_MS) delete cache[id];
  }
  await chrome.storage.local.set({ [SUMMARY_CACHE_KEY]: cache });
}

export async function patchCachedSummary(
  videoId: string,
  patch: Partial<Pick<CachedSummary, "commentSentiment" | "audienceScore" | "userRating">>,
): Promise<void> {
  const r = await chrome.storage.local.get(SUMMARY_CACHE_KEY);
  const cache = (r[SUMMARY_CACHE_KEY] as SummaryCache) ?? {};
  if (cache[videoId]) {
    cache[videoId] = { ...cache[videoId]!, ...patch };
    await chrome.storage.local.set({ [SUMMARY_CACHE_KEY]: cache });
  }
}

// --- Auto-run channel list ---------------------------------------------------

export async function getAutoRunChannels(): Promise<AutoRunChannel[]> {
  const r = await chrome.storage.local.get(AUTO_RUN_CHANNELS_KEY);
  const raw = (r[AUTO_RUN_CHANNELS_KEY] as Partial<AutoRunChannel>[]) ?? [];
  // Normalize legacy entries (added before autoRunSummary/autoRunComments fields existed).
  return raw.map((c) => ({
    autoRunSummary: true,
    autoRunComments: false,
    ...c,
  } as AutoRunChannel));
}

export async function setAutoRunChannels(channels: AutoRunChannel[]): Promise<void> {
  await chrome.storage.local.set({ [AUTO_RUN_CHANNELS_KEY]: channels });
}

/** Add or update a channel in the auto-run list (matched by id or name). */
export async function addAutoRunChannel(channel: AutoRunChannel): Promise<void> {
  const existing = await getAutoRunChannels();
  const filtered = existing.filter((c) => c.id !== channel.id && c.name !== channel.name);
  await setAutoRunChannels([channel, ...filtered]);
}

/** Remove a channel from the auto-run list entirely (matched by id or name). */
export async function removeAutoRunChannel(channelId: string): Promise<void> {
  const existing = await getAutoRunChannels();
  await setAutoRunChannels(existing.filter((c) => c.id !== channelId && c.name !== channelId));
}

/** Open searches whose tabs are still open; prunes any that have closed. */
export async function getOpenSearches(): Promise<OpenSearch[]> {
  const list = await readOpenSearches();
  if (list.length === 0) return list;
  const tabs = await chrome.tabs.query({});
  const open = new Set(tabs.map((t) => t.id));
  const pruned = list.filter((s) => open.has(s.tabId));
  if (pruned.length !== list.length) {
    await chrome.storage.session.set({ [OPEN_SEARCHES_KEY]: pruned });
  }
  return pruned;
}
