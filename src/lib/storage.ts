import type {
  AutoRunChannel,
  CachedSummary,
  DeliveryStatus,
  GeminiCallEntry,
  GeminiUsage,
  LifetimeStats,
  OpenSearch,
  PromptProfile,
  SearchHistoryEntry,
  Settings,
  StorageState,
  Tag,
} from "../types";
import {
  AUTO_RUN_CHANNELS_KEY,
  CHANNEL_TAGS_KEY,
  DEFAULT_SETTINGS,
  DELIVERY_STATUS_KEY,
  extractVideoId,
  GEMINI_CALL_LOG_KEY,
  GEMINI_USAGE_KEY,
  localDateKey,
  OPEN_SEARCHES_KEY,
  PENDING_KEY,
  STORAGE_KEYS,
  SUMMARY_CACHE_KEY,
  TAGS_KEY,
  TLDW_STATS_KEY,
  VIDEO_TAGS_KEY,
} from "./constants";
import { createDefaultProfiles } from "./profiles";
import {
  findCachedVariant,
  normalizeSummaryCache,
  pruneSummaryCache,
  upsertCachedVariant,
} from "./summaryCache";

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

// --- write serialization (mutex) -------------------------------------------
// chrome.storage has no atomic read-modify-write. Concurrent RMW sequences run —
// stats bumps from the summary / cache-hit / sponsor paths and the options page
// editing history — and a bare get→modify→set can interleave so the later set()
// clobbers the earlier one (lost stats, dropped history entries).
//
// Prefer the Web Locks API: it serializes across ALL same-origin realms, so a
// worker stats write and an options-page history edit (both the
// chrome-extension:// origin) coordinate. The in-realm promise-chain is a
// fallback for contexts without navigator.locks. (Content scripts run in the
// page's origin and share a separate lock scope — unavoidable, and they do far
// fewer storage writes.)
const writeChains = new Map<string, Promise<unknown>>();

export function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;
  if (locks && typeof locks.request === "function") {
    return locks.request(`tldw:${key}`, () => fn()) as Promise<T>;
  }
  // Fallback: in-realm promise chain. Run fn after prev settles (resolve OR
  // reject) so one failed RMW doesn't wedge the queue; store a never-rejecting
  // tail for the next waiter but return the real result so errors still surface.
  const prev = writeChains.get(key) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  writeChains.set(key, result.then(
    () => undefined,
    () => undefined,
  ));
  return result;
}

/**
 * Serialized read-modify-write of the history array. All history mutations
 * route through here (currently addHistoryEntry) so concurrent writers can't
 * clobber each other. The callback receives the current stored history and
 * returns the next array, or null to skip the write entirely.
 */
export async function mutateHistory(
  fn: (history: SearchHistoryEntry[]) => SearchHistoryEntry[] | null,
): Promise<void> {
  await withWriteLock(STORAGE_KEYS.history, async () => {
    const history = await getHistory();
    const next = fn(history);
    if (next !== null) await setHistory(next);
  });
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
  /** ms timestamp the prompt was queued, so a stale one isn't re-delivered on a
   *  much-later tab reload (peek doesn't consume). */
  at?: number;
};

/** Pending prompts older than this are ignored by peek — long enough for a slow
 *  composer to mount, short enough that a later reload doesn't re-submit. */
const PENDING_TTL_MS = 10 * 60 * 1000;

function normalizePending(raw: PendingData | string | undefined): PendingData | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return { prompt: raw }; // backward-compat
  return raw;
}

export async function setPendingPrompt(
  tabId: number,
  data: PendingData,
): Promise<void> {
  await withWriteLock(PENDING_KEY, async () => {
    const r = await chrome.storage.session.get(PENDING_KEY);
    const pending = (r[PENDING_KEY] as Record<number, PendingData>) ?? {};
    pending[tabId] = { ...data, at: data.at ?? Date.now() };
    await chrome.storage.session.set({ [PENDING_KEY]: pending });
  });
}

export async function takePendingPrompt(
  tabId: number,
): Promise<PendingData | undefined> {
  return withWriteLock(PENDING_KEY, async () => {
    const r = await chrome.storage.session.get(PENDING_KEY);
    const pending = (r[PENDING_KEY] as Record<number, PendingData | string>) ?? {};
    const raw = pending[tabId];
    if (raw !== undefined) {
      delete pending[tabId];
      await chrome.storage.session.set({ [PENDING_KEY]: pending });
    }
    return normalizePending(raw);
  });
}

/**
 * Read a tab's pending prompt WITHOUT consuming it. The injector reads at
 * document_idle, but on a cold chat-app load the composer can mount a beat after
 * the router resolves; deleting on the first read meant a retry had nothing
 * left. We keep the prompt until the injector reports an outcome
 * (clearPendingPrompt on INJECT_RESULT) — but ignore (and clean up) one older
 * than PENDING_TTL_MS so a much-later tab reload doesn't auto-resubmit a stale
 * prompt.
 */
export async function peekPendingPrompt(
  tabId: number,
): Promise<PendingData | undefined> {
  const r = await chrome.storage.session.get(PENDING_KEY);
  const pending = (r[PENDING_KEY] as Record<number, PendingData | string>) ?? {};
  const data = normalizePending(pending[tabId]);
  if (data?.at !== undefined && Date.now() - data.at > PENDING_TTL_MS) {
    await clearPendingPrompt(tabId);
    return undefined;
  }
  return data;
}

/** Drop a tab's pending prompt once a delivery attempt has completed. */
export async function clearPendingPrompt(tabId: number): Promise<void> {
  await withWriteLock(PENDING_KEY, async () => {
    const r = await chrome.storage.session.get(PENDING_KEY);
    const pending = (r[PENDING_KEY] as Record<number, PendingData | string>) ?? {};
    if (pending[tabId] !== undefined) {
      delete pending[tabId];
      await chrome.storage.session.set({ [PENDING_KEY]: pending });
    }
  });
}

// --- session-scoped list of open destination tabs ---

async function readOpenSearches(): Promise<OpenSearch[]> {
  const r = await chrome.storage.session.get(OPEN_SEARCHES_KEY);
  return (r[OPEN_SEARCHES_KEY] as OpenSearch[]) ?? [];
}

/** Record a destination tab we just opened (newest first, deduped, capped). */
export async function addOpenSearch(entry: OpenSearch): Promise<void> {
  await withWriteLock(OPEN_SEARCHES_KEY, async () => {
    const existing = (await readOpenSearches()).filter(
      (s) => s.tabId !== entry.tabId,
    );
    const next = [entry, ...existing].slice(0, 20);
    await chrome.storage.session.set({ [OPEN_SEARCHES_KEY]: next });
  });
}

/** Drop a search entry when its tab closes. */
export async function pruneOpenSearch(tabId: number): Promise<void> {
  await withWriteLock(OPEN_SEARCHES_KEY, async () => {
    const existing = await readOpenSearches();
    const next = existing.filter((s) => s.tabId !== tabId);
    if (next.length !== existing.length) {
      await chrome.storage.session.set({ [OPEN_SEARCHES_KEY]: next });
    }
  });
}

// --- session-scoped record of recent auto-fill outcomes ---

/** Record an auto-fill outcome (newest first, capped) for the popup to show. */
export async function recordDeliveryStatus(status: DeliveryStatus): Promise<void> {
  await withWriteLock(DELIVERY_STATUS_KEY, async () => {
    const r = await chrome.storage.session.get(DELIVERY_STATUS_KEY);
    const list = (r[DELIVERY_STATUS_KEY] as DeliveryStatus[]) ?? [];
    const next = [status, ...list].slice(0, 10);
    await chrome.storage.session.set({ [DELIVERY_STATUS_KEY]: next });
  });
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
 * Returns the new entry's id.
 */
async function _recordGeminiCall(
  video?: { url: string; title?: string },
  prompt?: string,
  response?: string,
): Promise<string> {
 return withWriteLock(GEMINI_USAGE_KEY, async () => {
  const [usage, logRaw, settings] = await Promise.all([
    getGeminiUsage(),
    chrome.storage.local.get(GEMINI_CALL_LOG_KEY),
    getSettings(),
  ]);

  const now = new Date();
  // Use the LOCAL calendar date: the popup/stats present "today's calls" as the
  // user's day, so the counter must reset at local midnight, not UTC midnight.
  const todayDate = localDateKey(now);
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
  // Default to metadata-only: the call COUNT already lives in geminiUsage, so we
  // don't need to store the (heavy) full prompt + raw response unless the user
  // opted in for prompt debugging.
  const keepFull = settings.keepFullCallLog;
  const newEntry: GeminiCallEntry = {
    id,
    videoUrl: video?.url ?? "",
    videoTitle: video?.title,
    at: now.toISOString(),
    prompt: keepFull ? prompt : undefined,
    response: keepFull ? response : undefined,
  };
  const updatedLog = [newEntry, ...existingLog].slice(0, CALL_LOG_LIMIT);

  await chrome.storage.local.set({
    [GEMINI_USAGE_KEY]: updatedUsage,
    [GEMINI_CALL_LOG_KEY]: updatedLog,
  });

  return id;
 });
}

export async function recordGeminiCall(
  video?: { url: string; title?: string },
  prompt?: string,
  response?: string,
): Promise<void> {
  await _recordGeminiCall(video, prompt, response);
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

// --- Lifetime usage stats -------------------------------------------------

function emptyLifetimeStats(): LifetimeStats {
  return {
    since: "",
    summaries: 0,
    cacheHits: 0,
    durationSummarizedSeconds: 0,
    sponsorSkips: 0,
    sponsorSecondsSaved: 0,
    activity: {},
  };
}

/**
 * Trim an activity record to the newest `maxKeys` calendar dates.
 * Pure helper (exported for tests).
 */
export function trimActivity(
  activity: Record<string, number>,
  maxKeys = 400, // > the 53-week (371-day) summary-activity heatmap window
): Record<string, number> {
  const keys = Object.keys(activity);
  if (keys.length <= maxKeys) return activity;
  // Sort descending (newest first) and keep only the first maxKeys.
  const keep = new Set(keys.sort((a, b) => b.localeCompare(a)).slice(0, maxKeys));
  const trimmed: Record<string, number> = {};
  for (const k of keep) trimmed[k] = activity[k]!;
  return trimmed;
}

export async function getLifetimeStats(): Promise<LifetimeStats> {
  const r = await chrome.storage.local.get(TLDW_STATS_KEY);
  const stored = r[TLDW_STATS_KEY] as Partial<LifetimeStats> | undefined;
  return {
    ...emptyLifetimeStats(),
    ...stored,
    activity: stored?.activity ?? {},
  };
}

/**
 * Read-modify-write for lifetime stats. Sets `since` on first write and
 * trims `activity` to the newest calendar dates.
 *
 * Serialized through withWriteLock: the message-driven design has several
 * concurrent callers (sponsor/summary/cache paths), so an un-serialized
 * get→set would lose counter updates.
 */
export async function bumpLifetimeStats(
  mutate: (s: LifetimeStats) => void,
): Promise<void> {
  await withWriteLock(TLDW_STATS_KEY, async () => {
    const stats = await getLifetimeStats();
    if (!stats.since) stats.since = new Date().toISOString();
    mutate(stats);
    stats.activity = trimActivity(stats.activity);
    await chrome.storage.local.set({ [TLDW_STATS_KEY]: stats });
  });
}

// --- Summary result cache -------------------------------------------------

async function readSummaryCache() {
  const r = await chrome.storage.local.get(SUMMARY_CACHE_KEY);
  return pruneSummaryCache(normalizeSummaryCache(r[SUMMARY_CACHE_KEY]));
}

export async function getCachedSummary(
  videoId: string,
  promptFingerprint?: string,
): Promise<CachedSummary | null> {
  return findCachedVariant(await readSummaryCache(), videoId, promptFingerprint);
}

export async function setCachedSummary(entry: CachedSummary): Promise<void> {
  await withWriteLock(SUMMARY_CACHE_KEY, async () => {
    const cache = await readSummaryCache();
    await chrome.storage.local.set({
      [SUMMARY_CACHE_KEY]: upsertCachedVariant(cache, entry),
    });
  });
}

export async function clearCachedSummaries(videoId?: string): Promise<void> {
  await withWriteLock(SUMMARY_CACHE_KEY, async () => {
    if (!videoId) {
      await chrome.storage.local.remove(SUMMARY_CACHE_KEY);
      return;
    }
    const cache = await readSummaryCache();
    await chrome.storage.local.set({
      [SUMMARY_CACHE_KEY]: {
        ...cache,
        entries: cache.entries.filter((entry) => entry.videoId !== videoId),
      },
    });
  });
}

export async function getCachedSummaryCount(): Promise<number> {
  return (await readSummaryCache()).entries.length;
}

/** Persist cache migration and pruning during worker startup. */
export async function maintainSummaryCache(): Promise<void> {
  await withWriteLock(SUMMARY_CACHE_KEY, async () => {
    const r = await chrome.storage.local.get(SUMMARY_CACHE_KEY);
    if (r[SUMMARY_CACHE_KEY] === undefined) return;
    const cache = pruneSummaryCache(normalizeSummaryCache(r[SUMMARY_CACHE_KEY]));
    if (cache.entries.length === 0) {
      await chrome.storage.local.remove(SUMMARY_CACHE_KEY);
    } else {
      await chrome.storage.local.set({ [SUMMARY_CACHE_KEY]: cache });
    }
  });
}

// --- Auto-run channel list ---------------------------------------------------

export async function getAutoRunChannels(): Promise<AutoRunChannel[]> {
  const r = await chrome.storage.local.get(AUTO_RUN_CHANNELS_KEY);
  const raw = (r[AUTO_RUN_CHANNELS_KEY] as Partial<AutoRunChannel>[]) ?? [];
  // Normalize legacy entries (added before the autoRunSummary field existed).
  return raw.map((c) => ({ autoRunSummary: true, ...c } as AutoRunChannel));
}

export async function setAutoRunChannels(channels: AutoRunChannel[]): Promise<void> {
  await chrome.storage.local.set({ [AUTO_RUN_CHANNELS_KEY]: channels });
}

/** Add or update a channel in the auto-run list (matched by id or name). */
export async function addAutoRunChannel(channel: AutoRunChannel): Promise<void> {
  await withWriteLock(AUTO_RUN_CHANNELS_KEY, async () => {
    const existing = await getAutoRunChannels();
    const filtered = existing.filter((c) => c.id !== channel.id && c.name !== channel.name);
    await setAutoRunChannels([channel, ...filtered]);
  });
}

/** Remove a channel from the auto-run list entirely (matched by id or name). */
export async function removeAutoRunChannel(channelId: string): Promise<void> {
  await withWriteLock(AUTO_RUN_CHANNELS_KEY, async () => {
    const existing = await getAutoRunChannels();
    await setAutoRunChannels(existing.filter((c) => c.id !== channelId && c.name !== channelId));
  });
}

// --- Tags (F6) --------------------------------------------------------------
// A tag = { id, label, prompt }. Assignments live in two maps:
//   CHANNEL_TAGS_KEY: channelKey -> tag ids   (auto-apply to the channel's videos)
//   VIDEO_TAGS_KEY:   videoId    -> tag ids   (one-off for a single video)
// The widget writes channel assignments under getChannelInfo().id (the /@Handle
// href, falling back to the name). The background only reliably has the display
// name, but it now also threads the channel id (VideoMeta.channelId), so
// getActiveTags matches channel tags by id OR name — the same belt-and-suspenders
// every other channel-scoped feature uses (auto-run, blocked). videoId =
// extractVideoId(url).
//
// OWNERSHIP: the on-page widget (content script, youtube.ts) is the SOLE writer of
// channel/video ASSIGNMENTS (via its own inline helpers). These storage helpers
// cover only what runs in the extension realm: getActiveTags (background resolve)
// and the tag-LIBRARY surface getTags/mutateTags/deleteTagEverywhere (options
// page). Caveat: the widget's content-script writes and these extension-realm
// writes use different lock scopes (Web Locks is per-origin), so a tag edited in
// the options page concurrently with a widget write could race — rare and
// low-stakes (a single dropped edit), accepted for now.

type TagAssignments = Record<string, string[]>;

export async function getTags(): Promise<Tag[]> {
  const r = await chrome.storage.local.get(TAGS_KEY);
  return (r[TAGS_KEY] as Tag[]) ?? [];
}

/** Serialized read-modify-write of the tag library — use this for edits so a
 *  concurrent write (e.g. the widget's quick-create) isn't clobbered by a blind
 *  overwrite of a stale snapshot. */
export async function mutateTags(fn: (tags: Tag[]) => Tag[]): Promise<void> {
  await withWriteLock(TAGS_KEY, async () => {
    const tags = await getTags();
    await chrome.storage.local.set({ [TAGS_KEY]: fn(tags) });
  });
}

async function readAssignments(key: string): Promise<TagAssignments> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as TagAssignments) ?? {};
}

/**
 * The active tags for a video: (channel tags ∪ video tags), deduped, resolved
 * against the library and returned in library order. Channel tags are matched by
 * id OR name (the widget keys by id-with-name-fallback). Ids with no surviving
 * library entry (a deleted tag) are dropped.
 */
export async function getActiveTags(args: {
  channelId?: string;
  channelName?: string;
  videoId?: string;
}): Promise<Tag[]> {
  const [library, channelMap, videoMap] = await Promise.all([
    getTags(),
    readAssignments(CHANNEL_TAGS_KEY),
    readAssignments(VIDEO_TAGS_KEY),
  ]);
  const ids = new Set<string>([
    ...(args.channelId ? channelMap[args.channelId] ?? [] : []),
    ...(args.channelName ? channelMap[args.channelName] ?? [] : []),
    ...(args.videoId ? videoMap[args.videoId] ?? [] : []),
  ]);
  return library.filter((t) => ids.has(t.id));
}

/** Drop VIDEO-tag assignments whose video has aged out of history. Video tags are
 *  one-off per-video, so once the video leaves history the assignment is orphaned
 *  and unreachable — without this the VIDEO_TAGS_KEY map grows unbounded (one
 *  entry per ever-tagged video), the only storage key with no natural cap.
 *  CHANNEL tags are intentionally NOT swept: a channel stays valid (and taggable)
 *  even when nothing of its is currently in history. Runs from the startup sweep. */
export async function pruneOrphanVideoTags(): Promise<void> {
  await withWriteLock(VIDEO_TAGS_KEY, async () => {
    const [history, map] = await Promise.all([getHistory(), readAssignments(VIDEO_TAGS_KEY)]);
    if (Object.keys(map).length === 0) return;
    const live = new Set(history.map((e) => extractVideoId(e.videoUrl)).filter(Boolean));
    let changed = false;
    for (const vid of Object.keys(map)) {
      if (!live.has(vid)) { delete map[vid]; changed = true; }
    }
    if (changed) await chrome.storage.local.set({ [VIDEO_TAGS_KEY]: map });
  });
}

/** Delete a tag from the library AND strip its id from every channel/video
 *  assignment, so no orphaned ids remain (the UI promises this on delete). */
export async function deleteTagEverywhere(tagId: string): Promise<void> {
  await mutateTags((tags) => tags.filter((t) => t.id !== tagId));
  for (const key of [CHANNEL_TAGS_KEY, VIDEO_TAGS_KEY]) {
    await withWriteLock(key, async () => {
      const map = await readAssignments(key);
      let changed = false;
      for (const bucket of Object.keys(map)) {
        const next = map[bucket]!.filter((id) => id !== tagId);
        if (next.length !== map[bucket]!.length) {
          changed = true;
          if (next.length) map[bucket] = next;
          else delete map[bucket];
        }
      }
      if (changed) await chrome.storage.local.set({ [key]: map });
    });
  }
}

/** Open searches whose tabs are still open; prunes any that have closed. */
export async function getOpenSearches(): Promise<OpenSearch[]> {
  const list = await readOpenSearches();
  if (list.length === 0) return list;
  const tabs = await chrome.tabs.query({});
  const open = new Set(tabs.map((t) => t.id));
  const pruned = list.filter((s) => open.has(s.tabId));
  if (pruned.length !== list.length) {
    // Re-read under the lock so this prune-write can't clobber a concurrent
    // addOpenSearch/pruneOpenSearch on the same key.
    await withWriteLock(OPEN_SEARCHES_KEY, async () => {
      const current = await readOpenSearches();
      const stillOpen = current.filter((s) => open.has(s.tabId));
      if (stillOpen.length !== current.length) {
        await chrome.storage.session.set({ [OPEN_SEARCHES_KEY]: stillOpen });
      }
    });
  }
  return pruned;
}
