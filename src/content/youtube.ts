/**
 * Runs on youtube.com watch pages. On request from the background worker it
 * extracts the video's transcript by driving YouTube's own "Show transcript"
 * panel and reading the rendered segments.
 *
 * Why the DOM instead of fetching the caption file: as of 2026 YouTube's
 * timedtext endpoint requires a proof-of-origin (PO) token and returns an
 * empty body without it, so a plain fetch — even from the extension with the
 * user's cookies — yields nothing. The transcript panel works because the page
 * itself mints the token and paints the lines into the DOM; we just read them.
 *
 * This only sees the currently-loaded video, so a right-clicked thumbnail (a
 * different video) gets no transcript — the background worker handles that.
 *
 * Logs are prefixed with [TL;DW] so failures are easy to diagnose in the page
 * console — YouTube's markup shifts, and these selectors may need updates.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log("[TL;DW]", ...args);

const SEGMENT_SELECTORS = [
  "ytd-transcript-segment-renderer",
  "ytd-transcript-segment-list-renderer .segment",
  "[class*='transcript'] [class*='segment']",
];

/** Pull the spoken text out of a single transcript segment element. */
function segmentText(segment: Element): string | undefined {
  const direct =
    segment.querySelector(".segment-text")?.textContent ??
    segment.querySelector("yt-formatted-string")?.textContent;
  if (direct?.trim()) return direct.trim();
  // Fall back to the segment's own text, dropping a leading "1:23" timestamp.
  return segment.textContent?.replace(/^\s*\d+:\d+(?::\d+)?\s*/, "").trim() || undefined;
}

/** Read the rendered transcript panel, or null if it isn't open yet. */
function readSegments(): string | null {
  for (const selector of SEGMENT_SELECTORS) {
    const segments = document.querySelectorAll(selector);
    if (segments.length === 0) continue;

    const lines: string[] = [];
    segments.forEach((segment) => {
      const text = segmentText(segment);
      if (text) lines.push(text);
    });

    if (lines.length > 0) {
      return lines.join(" ").replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

/** Click YouTube's description "…more" expander so hidden sections mount. */
function expandDescription(): void {
  const expander = document.querySelector<HTMLElement>(
    "ytd-text-inline-expander #expand, tp-yt-paper-button#expand, #description #expand, #expand",
  );
  if (expander) {
    log("expanding description");
    expander.click();
  } else {
    log("no description expander found");
  }
}

/** Find YouTube's "Show transcript" control via a few resilient strategies. */
function findShowTranscriptButton(): HTMLElement | null {
  // 1) Inside the dedicated transcript section of the structured description.
  const section = document.querySelector(
    "ytd-video-description-transcript-section-renderer",
  );
  const sectionBtn = section?.querySelector<HTMLElement>("button");
  if (sectionBtn) return sectionBtn;

  // 2) Any button whose accessible label mentions "transcript".
  const labelled = document.querySelectorAll<HTMLElement>("button[aria-label]");
  for (const el of labelled) {
    if (/transcript/i.test(el.getAttribute("aria-label") ?? "")) return el;
  }

  // 3) Last resort: match on the visible label text.
  const candidates = document.querySelectorAll<HTMLElement>(
    "button, ytd-button-renderer, tp-yt-paper-button, yt-button-shape",
  );
  for (const el of candidates) {
    if (/^show transcript$/i.test(el.textContent?.trim() ?? "")) return el;
  }
  return null;
}

async function getTranscript(): Promise<string | null> {
  // Already open (user opened it, or a prior run did)? Read it directly.
  const open = readSegments();
  if (open) {
    log("transcript already open:", open.length, "chars");
    return open;
  }

  expandDescription();

  // The transcript button mounts asynchronously after expanding; poll for it.
  let button: HTMLElement | null = null;
  const buttonDeadline = Date.now() + 4000;
  while (Date.now() < buttonDeadline) {
    button = findShowTranscriptButton();
    if (button) break;
    await sleep(200);
  }
  if (!button) {
    log("could not find a 'Show transcript' button — does this video have captions?");
    return null;
  }
  log("clicking 'Show transcript'");
  button.click();

  // Segments render asynchronously; poll until they appear or we give up.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(200);
    const text = readSegments();
    if (text) {
      log("transcript captured:", text.length, "chars");
      return text;
    }
  }
  log("transcript panel never rendered segments");
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as { type?: string })?.type === "GET_TRANSCRIPT") {
    log("transcript requested");
    void getTranscript().then((transcript) => sendResponse({ transcript }));
    return true; // keep the channel open for the async response
  }
  return false;
});

export {};
