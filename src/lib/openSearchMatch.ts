import { extractVideoId } from "./constants";
import type { OpenSearch } from "../types";

/**
 * The destination tab TL;DW already opened for this video, if one is still
 * recorded. Searches are stored newest-first. The video id must match: one
 * YouTube tab plays many videos over time (in-page navigation keeps the tab),
 * so matching on the tab alone could focus another video's chat. Among the
 * searches for this video, one sent from the same YouTube tab wins.
 */
export function findOpenSearchForVideo(
  searches: OpenSearch[],
  videoId: string | null | undefined,
  sourceTabId?: number,
): OpenSearch | undefined {
  if (!videoId) return undefined;
  const forVideo = searches.filter(
    (s) => !!s.videoUrl && extractVideoId(s.videoUrl) === videoId,
  );
  return (
    (sourceTabId !== undefined
      ? forVideo.find((s) => s.sourceTabId === sourceTabId)
      : undefined) ?? forVideo[0]
  );
}

/**
 * The cache entry context for a summary scraped from `search`'s destination
 * tab, or undefined when it must not be cached: no context was recorded, or the
 * prompt carried a transcript for a different video than the one it is cached
 * under (a summary of the wrong video would be served on every later visit).
 */
export function cacheContextForScrape(
  search: OpenSearch | undefined,
): OpenSearch["cacheContext"] | undefined {
  const context = search?.cacheContext;
  if (!context) return undefined;
  if (search.transcriptVideoId !== undefined && search.transcriptVideoId !== context.videoId) {
    return undefined;
  }
  if (search.videoUrl && extractVideoId(search.videoUrl) !== context.videoId) return undefined;
  return context;
}
