import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from "./constants";
import type { CachedSummary, SummaryCache } from "../types";

export const SUMMARY_CACHE_VERSION = 2;

export function emptySummaryCache(): SummaryCache {
  return { version: SUMMARY_CACHE_VERSION, entries: [] };
}

export function normalizeSummaryCache(value: unknown): SummaryCache {
  if (!value || typeof value !== "object") return emptySummaryCache();
  const candidate = value as Partial<SummaryCache>;
  if (candidate.version !== SUMMARY_CACHE_VERSION || !Array.isArray(candidate.entries)) {
    return emptySummaryCache();
  }
  return { version: SUMMARY_CACHE_VERSION, entries: candidate.entries };
}

export function pruneSummaryCache(cache: SummaryCache, now = Date.now()): SummaryCache {
  return {
    version: SUMMARY_CACHE_VERSION,
    entries: cache.entries
      .filter((entry) => now - new Date(entry.createdAt).getTime() <= CACHE_TTL_MS)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, CACHE_MAX_ENTRIES),
  };
}

export function findCachedVariant(
  cache: SummaryCache,
  videoId: string,
  promptFingerprint?: string,
): CachedSummary | null {
  return cache.entries
    .filter((entry) =>
      entry.videoId === videoId &&
      (!promptFingerprint || entry.promptFingerprint === promptFingerprint)
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}

export function upsertCachedVariant(cache: SummaryCache, entry: CachedSummary): SummaryCache {
  const entries = cache.entries.filter(
    (candidate) =>
      candidate.videoId !== entry.videoId ||
      candidate.promptFingerprint !== entry.promptFingerprint,
  );
  return pruneSummaryCache({ version: SUMMARY_CACHE_VERSION, entries: [entry, ...entries] });
}

export async function fingerprintPrompt(prompt: string, modelOrDestination: string): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify({ prompt, modelOrDestination }));
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
