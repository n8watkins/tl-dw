/**
 * Where an on-page summary came from, and how the summary panel's "⋯" menu
 * describes it. The worker tags every SET_SUMMARY with a kind; the label is the
 * profile name (cache) or the destination name (tab).
 */
export type SummarySourceKind = "cache" | "api" | "tab";

export type SummarySourceItem = {
  label: string;
  title: string;
  /** What clicking the menu row opens: an options section. */
  section: "settings" | "directapi";
};

/** Prefix of a cached summary's source label: "cached · <profile name>". */
const CACHED_PREFIX = "cached · ";

export function cachedSourceLabel(profileName: string): string {
  return `${CACHED_PREFIX}${profileName}`;
}

/**
 * The menu row for a summary's origin, or null when there is none to show.
 * `kind` is authoritative; without it (a message from an older worker) the
 * label decides: "cached · ..." is the cache, "Gemini API" the API, and any
 * other label the destination tab the summary was read from.
 */
export function describeSummarySource(
  source: string | undefined,
  kind?: SummarySourceKind,
): SummarySourceItem | null {
  if (!source && !kind) return null;
  const resolved: SummarySourceKind =
    kind ??
    (source?.startsWith(CACHED_PREFIX) || source === "cached"
      ? "cache"
      : source === "Gemini API"
        ? "api"
        : "tab");
  if (resolved === "cache") {
    const profile = source?.startsWith(CACHED_PREFIX) ? source.slice(CACHED_PREFIX.length) : "";
    return {
      label: profile ? `💾 Cached (${profile})` : "💾 Cached",
      title:
        "Served from your saved cache: an earlier result for this video, not a fresh call. " +
        "Click to manage cached summaries.",
      section: "settings",
    };
  }
  if (resolved === "api") {
    return {
      label: source && source !== "Gemini API" ? `⚡ ${source}` : "⚡ Gemini API",
      title: "This summary came straight from the Gemini API: no tab. Click for Direct API settings.",
      section: "directapi",
    };
  }
  const destination = source || "the AI";
  return {
    label: `💬 From ${destination}`,
    title:
      `Read back from the ${destination} tab TL;DW opened. ` +
      "Click to set up the Gemini API for instant summaries without a tab.",
    section: "directapi",
  };
}
