/**
 * Where an on-page summary came from. The worker tags every SET_SUMMARY with
 * a kind; the panel's source line says it in words.
 */
export type SummarySourceKind = "cache" | "api" | "tab";

/** Prefix of a cached summary's source label: "cached · <profile name>". */
const CACHED_PREFIX = "cached · ";

export function cachedSourceLabel(profileName: string): string {
  return `${CACHED_PREFIX}${profileName}`;
}
