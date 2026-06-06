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

function relay(kind: "get_transcript" | "timedtext", body: unknown): void {
  window.postMessage({ __tldw: true, kind, body }, "*");
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
    if (url.includes(TRANSCRIPT_PATH)) {
      void promise.then((res) =>
        res
          .clone()
          .json()
          .then((body) => relay("get_transcript", body))
          .catch(() => {}),
      );
    } else if (url.includes(TIMEDTEXT_PATH)) {
      void promise.then((res) =>
        res
          .clone()
          .text()
          .then((body) => relay("timedtext", body))
          .catch(() => {}),
      );
    }
  } catch {
    // Never let instrumentation break the page's own fetch.
  }
  return promise;
};

export {};
