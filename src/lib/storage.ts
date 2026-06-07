import type {
  DeliveryStatus,
  GeminiUsage,
  OpenSearch,
  PromptProfile,
  SearchHistoryEntry,
  Settings,
  StorageState,
} from "../types";
import {
  DEFAULT_SETTINGS,
  DELIVERY_STATUS_KEY,
  GEMINI_USAGE_KEY,
  OPEN_SEARCHES_KEY,
  PENDING_KEY,
  STORAGE_KEYS,
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

// --- Gemini API usage stats (local, persisted across sessions) -------------

export async function getGeminiUsage(): Promise<GeminiUsage> {
  const r = await chrome.storage.local.get(GEMINI_USAGE_KEY);
  return (r[GEMINI_USAGE_KEY] as GeminiUsage | undefined) ?? { totalCalls: 0 };
}

export async function recordGeminiCall(): Promise<void> {
  const usage = await getGeminiUsage();
  await chrome.storage.local.set({
    [GEMINI_USAGE_KEY]: {
      totalCalls: usage.totalCalls + 1,
      lastCalledAt: new Date().toISOString(),
    } satisfies GeminiUsage,
  });
}

export async function clearGeminiUsage(): Promise<void> {
  await chrome.storage.local.remove(GEMINI_USAGE_KEY);
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
