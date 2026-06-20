import type {
  AutoRunChannel,
  BlockedChannel,
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
} from "../types";
import { computeEngagementVerdict, VERDICT_RANK } from "./engagement";
import {
  AUTO_RUN_CHANNELS_KEY,
  BLOCKED_CHANNELS_KEY,
  CACHE_TTL_MS,
  DEFAULT_SETTINGS,
  DELIVERY_STATUS_KEY,
  extractVideoId,
  GEMINI_CALL_LOG_KEY,
  GEMINI_USAGE_KEY,
  localDateKey,
  OPEN_SEARCHES_KEY,
  PENDING_KEY,
  pruneCache,
  STORAGE_KEYS,
  SUMMARY_CACHE_KEY,
  TLDW_STATS_KEY,
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

// --- write serialization (mutex) -------------------------------------------
// chrome.storage has no atomic read-modify-write. Many concurrent RMW sequences
// run — WATCH_PROGRESS fires from every open YouTube tab (all routed to the one
// worker), stats bumps from the summary / cache-hit / sponsor paths, and the
// options page editing history — and a bare get→modify→set can interleave so the
// later set() clobbers the earlier one (lost stats, dropped history entries).
//
// Prefer the Web Locks API: it serializes across ALL same-origin realms, so a
// worker WATCH_PROGRESS write and an options-page history edit (both the
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
 * (recordWatchProgress, addHistoryEntry) route through here so concurrent
 * writers can't clobber each other. The callback receives the current stored
 * history and returns the next array, or null to skip the write entirely.
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

/**
 * Record a watch-progress delta for `videoId`, accumulate the total, compute an
 * engagement verdict (Engaged/Skimmed/Skipped), and persist it using the
 * upgrade-only rule (skip→skim→watch, never downgrade).
 *
 * - Finds the newest history entry for the video (matched by extractVideoId).
 * - If none exists and the delta > 0 or a non-null verdict would result: creates
 *   a lightweight stub entry (analogous to the old addRatingOnlyHistoryEntry).
 * - After updating, mirrors the userRating into the summary-cache entry so a
 *   cached summary panel reflects the auto-verdict.
 */
export async function recordWatchProgress(args: {
  videoId: string;
  deltaSeconds: number;
  durationSeconds: number;
  sawSummary: boolean;
  video: { url: string; title?: string; channel?: string; avatarUrl?: string };
  settings: Settings;
}): Promise<void> {
  const { videoId, deltaSeconds, durationSeconds, sawSummary, video, settings } = args;

  // The previous rating (before this update) and the resulting entry, captured
  // out of the serialized history mutation so we can bump stats afterward.
  let updatedEntry: SearchHistoryEntry | null = null;
  let prevRating: "watch" | "skim" | "skip" | undefined;

  await mutateHistory((history) => {
    const idx = history.findIndex((e) => extractVideoId(e.videoUrl) === videoId);

    // Compute prospective accumulated total if we find (or create) an entry.
    const existingEntry = idx !== -1 ? history[idx]! : null;
    const prevWatched = existingEntry?.watchedSeconds ?? 0;
    const newWatched = prevWatched + deltaSeconds;

    const verdict = computeEngagementVerdict(newWatched, durationSeconds, {
      engagedPct: settings.engagedPct,
      skimmedPct: settings.skimmedPct,
      sawSummary,
    });

    // If there's no entry and we have nothing meaningful to store, skip the write.
    if (idx === -1 && deltaSeconds <= 0 && verdict === null) return null;

    if (idx !== -1) {
      // Existing entry — accumulate and potentially upgrade verdict.
      const current = history[idx]!;
      prevRating = current.userRating;
      const currentRank = VERDICT_RANK[current.userRating ?? "null"] ?? 0;
      const newRank = VERDICT_RANK[verdict ?? "null"] ?? 0;
      // Only upgrade: replace stored rating when new rank is strictly higher.
      const nextRating: "watch" | "skim" | "skip" | undefined =
        newRank > currentRank && verdict !== null
          ? (verdict as "watch" | "skim" | "skip")
          : current.userRating;

      updatedEntry = {
        ...current,
        watchedSeconds: newWatched,
        durationSeconds: durationSeconds || current.durationSeconds,
        ...(nextRating !== undefined ? { userRating: nextRating } : {}),
      };
      history[idx] = updatedEntry;
      return history;
    }

    // No existing entry — create a stub so the channel shows up in Channels view.
    const stub: SearchHistoryEntry = {
      id: crypto.randomUUID(),
      videoUrl: video.url,
      videoTitle: video.title,
      channel: video.channel,
      channelAvatarUrl: video.avatarUrl,
      profileId: "",
      profileName: "",
      prompt: "",
      watchedSeconds: newWatched,
      durationSeconds: durationSeconds || undefined,
      ...(verdict !== null && verdict !== undefined ? { userRating: verdict as "watch" | "skim" | "skip" } : {}),
      createdAt: new Date().toISOString(),
    };
    updatedEntry = stub;
    let next = [stub, ...history];
    if (settings.autoExpireHistory) {
      const cutoff = Date.now() - settings.historyExpiryDays * 24 * 60 * 60 * 1000;
      next = next.filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return Number.isNaN(t) || t >= cutoff;
      });
    }
    if (settings.historyLimit !== "unlimited") {
      next = next.slice(0, settings.historyLimit);
    }
    return next;
  });

  if (!updatedEntry) return;
  // TS can't see that the closure assigned these; narrow explicitly.
  const entry = updatedEntry as SearchHistoryEntry;

  // --- Bump lifetime stats: watch time + verdict transitions ---------------
  const newRating = entry.userRating;
  if (deltaSeconds > 0 || (newRating !== undefined && newRating !== prevRating)) {
    await bumpLifetimeStats((s) => {
      if (deltaSeconds > 0) s.secondsWatched += deltaSeconds;
      if (newRating !== undefined && newRating !== prevRating) {
        const delta = verdictCounterDelta(prevRating, newRating);
        s.engaged = Math.max(0, s.engaged + delta.engaged);
        s.skimmed = Math.max(0, s.skimmed + delta.skimmed);
        s.skipped = Math.max(0, s.skipped + delta.skipped);
      }
    });
  }

  // Mirror the auto-rating into the summary cache so cached panels reflect it.
  if (entry.userRating !== undefined) {
    await withWriteLock(SUMMARY_CACHE_KEY, async () => {
      const r = await chrome.storage.local.get(SUMMARY_CACHE_KEY);
      const cache = (r[SUMMARY_CACHE_KEY] as Record<string, { tldw: unknown; cachedAt: string; userRating?: string }>) ?? {};
      if (cache[videoId]) {
        cache[videoId]!.userRating = entry.userRating;
        await chrome.storage.local.set({ [SUMMARY_CACHE_KEY]: cache });
      }
    });
  }
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
    secondsWatched: 0,
    engaged: 0,
    skimmed: 0,
    skipped: 0,
    activity: {},
  };
}

/**
 * Trim an activity record to the newest `maxKeys` calendar dates.
 * Pure helper (exported for tests).
 */
export function trimActivity(
  activity: Record<string, number>,
  maxKeys = 366,
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
  return { ...emptyLifetimeStats(), ...stored, activity: stored?.activity ?? {} };
}

/**
 * Read-modify-write for lifetime stats. Sets `since` on first write and
 * trims `activity` to the newest 366 calendar dates.
 *
 * Serialized through withWriteLock: the message-driven design has many
 * concurrent callers (WATCH_PROGRESS from every tab, sponsor/summary/cache
 * paths), so an un-serialized get→set would lose counter updates.
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

/**
 * Compute the delta to apply to the three lifetime verdict counters when a
 * history entry's userRating transitions from `prev` to `next`.
 *
 * Rules:
 * - Decrement the old bucket (floor 0 is enforced by callers).
 * - Increment the new bucket.
 * - If `prev === next` (no transition), return all zeros.
 *
 * Pure helper exported for unit tests.
 */
export function verdictCounterDelta(
  prev: "watch" | "skim" | "skip" | undefined,
  next: "watch" | "skim" | "skip",
): { engaged: number; skimmed: number; skipped: number } {
  const delta = { engaged: 0, skimmed: 0, skipped: 0 };
  if (prev === next) return delta;
  // Decrement old
  if (prev === "watch") delta.engaged -= 1;
  else if (prev === "skim") delta.skimmed -= 1;
  else if (prev === "skip") delta.skipped -= 1;
  // Increment new
  if (next === "watch") delta.engaged += 1;
  else if (next === "skim") delta.skimmed += 1;
  else if (next === "skip") delta.skipped += 1;
  return delta;
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
  await withWriteLock(SUMMARY_CACHE_KEY, async () => {
    const r = await chrome.storage.local.get(SUMMARY_CACHE_KEY);
    const cache = (r[SUMMARY_CACHE_KEY] as SummaryCache) ?? {};
    cache[videoId] = entry;
    // Bound growth on every write: drop stale entries (TTL) and cap the count.
    pruneCache(cache);
    await chrome.storage.local.set({ [SUMMARY_CACHE_KEY]: cache });
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

// --- Blocked channel list ---------------------------------------------------

export async function getBlockedChannels(): Promise<BlockedChannel[]> {
  const r = await chrome.storage.local.get(BLOCKED_CHANNELS_KEY);
  return (r[BLOCKED_CHANNELS_KEY] as BlockedChannel[]) ?? [];
}

export async function setBlockedChannels(channels: BlockedChannel[]): Promise<void> {
  await chrome.storage.local.set({ [BLOCKED_CHANNELS_KEY]: channels });
}

/** Add or update a channel in the blocked list (matched by id or name). */
export async function addBlockedChannel(channel: BlockedChannel): Promise<void> {
  await withWriteLock(BLOCKED_CHANNELS_KEY, async () => {
    const existing = await getBlockedChannels();
    const filtered = existing.filter((c) => c.id !== channel.id && c.name !== channel.name);
    await setBlockedChannels([channel, ...filtered]);
  });
}

/** Remove a channel from the blocked list (matched by id or name). */
export async function removeBlockedChannel(channelId: string): Promise<void> {
  await withWriteLock(BLOCKED_CHANNELS_KEY, async () => {
    const existing = await getBlockedChannels();
    await setBlockedChannels(existing.filter((c) => c.id !== channelId && c.name !== channelId));
  });
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
