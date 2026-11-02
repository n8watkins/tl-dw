/**
 * Runs in the page's MAIN world at document_start so it can wrap the page's own
 * window.fetch before YouTube uses it. When YouTube fetches a transcript, we
 * clone the response and relay it to the isolated content script via
 * postMessage. Current YouTube (2026) loads the transcript panel through the
 * InnerTube `get_panel` call; older layouts used `get_transcript`, and a
 * `timedtext` caption request issued through fetch is read too.
 *
 * This reads YouTube's transcript *data source*, so it is independent of the
 * panel's markup (classic vs modern), shadow DOM, list virtualization, and any
 * other extension (e.g. vidIQ) mutating the rendered panel. MAIN-world scripts
 * have no chrome.* APIs, hence the postMessage hand-off.
 */

const PANEL_PATH = "/youtubei/v1/get_panel";
const TRANSCRIPT_PATH = "/youtubei/v1/get_transcript";
const TIMEDTEXT_PATH = "/api/timedtext";
// get_panel serves every engagement panel; only relay the transcript one.
const PANEL_TRANSCRIPT_MARKER = '"transcriptSegmentViewModel"';

console.log("[TL;DW] fetch interceptor installed");

function relay(
  kind: "get_panel" | "get_transcript" | "timedtext",
  body: unknown,
  videoId: string | undefined,
  failedStatus?: number,
): void {
  // Target our own origin (not "*") so a same-page cross-origin iframe can't read
  // the relayed transcript; the isolated-world listener also checks event.source.
  window.postMessage({ __tldw: true, kind, body, videoId, failedStatus }, location.origin);
}

/** The watch video id from the current URL (the page being viewed when the
 *  request is *issued*, captured synchronously, before any nav resolves).
 *  Undefined off a watch page, Shorts included: TL;DW reads nothing there. */
function currentUrlVideoId(): string | undefined {
  try {
    if (location.pathname !== "/watch") return undefined;
    return new URLSearchParams(location.search).get("v") || undefined;
  } catch {
    return undefined;
  }
}

// --- player-info bridge ----------------------------------------------------
// The isolated content script can't call the player's own API (it lives in this
// world), so it asks here. YouTube's player response is the page's own record
// of the loaded video: its id, its real length (not a pre-roll ad's), whether
// it is live right now, and whether it has caption tracks (no captions means no
// transcript). The request and reply are synchronous DOM events, so the
// isolated script gets the answer before its dispatchEvent call returns.
const PLAYER_INFO_REQUEST = "tldw:player-info-request";
const PLAYER_INFO_REPLY = "tldw:player-info";

type PlayerResponseLike = {
  videoDetails?: { videoId?: unknown; lengthSeconds?: unknown; isLive?: unknown };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } };
};

function readPlayerInfo(): string {
  try {
    const player = document.getElementById("movie_player") as
      | (HTMLElement & { getPlayerResponse?: () => PlayerResponseLike | null | undefined })
      | null;
    const res = player?.getPlayerResponse?.();
    const details = res?.videoDetails;
    if (!details || typeof details.videoId !== "string" || !details.videoId) return "null";
    const tracks = res?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return JSON.stringify({
      videoId: details.videoId,
      lengthSeconds: Number(details.lengthSeconds) || 0,
      isLive: details.isLive === true,
      hasCaptions: Array.isArray(tracks) && tracks.length > 0,
    });
  } catch {
    return "null";
  }
}

document.addEventListener(PLAYER_INFO_REQUEST, () => {
  document.dispatchEvent(new CustomEvent(PLAYER_INFO_REPLY, { detail: readPlayerInfo() }));
});

const originalFetch = window.fetch;
window.fetch = function patchedFetch(
  this: unknown,
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  const promise = originalFetch.apply(this as typeof globalThis, args);
  try {
    const input = args[0];
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request | undefined)?.url ?? "";
    // Capture the video id NOW, when the request is issued — the page is still
    // showing the video being fetched. Reading it when the response resolves
    // (potentially after an SPA nav) would mis-tag a late response with the new
    // video. timedtext carries the id in its URL; get_transcript does not, so it
    // falls back to the current-URL id at request time.
    const reqVideoId = currentUrlVideoId();
    if (!reqVideoId) return promise;
    if (url.includes(PANEL_PATH)) {
      void promise.then((res) =>
        res
          .clone()
          .text()
          .then((text) => {
            if (!text.includes(PANEL_TRANSCRIPT_MARKER)) return;
            relay("get_panel", JSON.parse(text) as unknown, reqVideoId);
          })
          .catch(() => {}),
      );
    } else if (url.includes(TRANSCRIPT_PATH)) {
      void promise.then((res) =>
        res
          .clone()
          .json()
          .catch(() => null)
          // get_transcript serves only transcripts, so a failure is this
          // video's transcript failing to load (YouTube answers some videos
          // with 400 FAILED_PRECONDITION, and its own panel stays empty).
          .then((body) => relay("get_transcript", body, reqVideoId, res.ok ? undefined : res.status))
          .catch(() => {}),
      );
    } else if (url.includes(TIMEDTEXT_PATH)) {
      let ttVideoId = reqVideoId;
      try {
        ttVideoId = new URL(url, location.href).searchParams.get("v") ?? reqVideoId;
      } catch {
        /* keep reqVideoId */
      }
      void promise.then((res) =>
        res
          .clone()
          .text()
          .then((body) => relay("timedtext", body, ttVideoId))
          .catch(() => {}),
      );
    }
  } catch {
    // Never let instrumentation break the page's own fetch.
  }
  return promise;
};

export {};
