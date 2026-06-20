/**
 * Runs in the page's MAIN world at document_start so it can wrap the page's own
 * window.fetch before YouTube uses it. When YouTube fetches a transcript — the
 * panel's `get_transcript` InnerTube call, or the player's `timedtext` caption
 * request — we clone the response and relay it to the isolated content script
 * via postMessage.
 *
 * This reads YouTube's transcript *data source*, so it is independent of the
 * panel's markup (classic vs modern), shadow DOM, list virtualization, and any
 * other extension (e.g. vidIQ) mutating the rendered panel. MAIN-world scripts
 * have no chrome.* APIs, hence the postMessage hand-off.
 */

const TRANSCRIPT_PATH = "/youtubei/v1/get_transcript";
const TIMEDTEXT_PATH = "/api/timedtext";

console.log("[TL;DW] fetch interceptor installed");

function relay(
  kind: "get_transcript" | "timedtext",
  body: unknown,
  videoId: string | undefined,
): void {
  window.postMessage({ __tldw: true, kind, body, videoId }, "*");
}

/** The watch video id from the current URL (the page being viewed when the
 *  request is *issued* — captured synchronously, before any nav resolves). */
function currentUrlVideoId(): string | undefined {
  try {
    return new URLSearchParams(location.search).get("v") ?? undefined;
  } catch {
    return undefined;
  }
}

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
    if (url.includes(TRANSCRIPT_PATH)) {
      void promise.then((res) =>
        res
          .clone()
          .json()
          .then((body) => relay("get_transcript", body, reqVideoId))
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
