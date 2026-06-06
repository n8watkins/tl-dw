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
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SEGMENT_SELECTOR = "ytd-transcript-segment-renderer";

/** Read the rendered transcript panel, or null if it isn't open yet. */
function readSegments(): string | null {
  const segments = document.querySelectorAll(SEGMENT_SELECTOR);
  if (segments.length === 0) return null;

  const lines: string[] = [];
  segments.forEach((segment) => {
    const text = segment.querySelector(".segment-text")?.textContent?.trim();
    if (text) lines.push(text);
  });

  if (lines.length === 0) return null;
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** Find YouTube's "Show transcript" control via a few resilient strategies. */
function findShowTranscriptButton(): HTMLElement | null {
  const byAria = document.querySelector<HTMLElement>(
    'button[aria-label="Show transcript" i]',
  );
  if (byAria) return byAria;

  const section = document.querySelector(
    "ytd-video-description-transcript-section-renderer",
  );
  const sectionBtn = section?.querySelector<HTMLElement>("button");
  if (sectionBtn) return sectionBtn;

  // Last resort: match on the visible label.
  const candidates = document.querySelectorAll<HTMLElement>(
    "button, ytd-button-renderer, tp-yt-paper-button",
  );
  for (const el of candidates) {
    if (el.textContent?.trim().toLowerCase() === "show transcript") return el;
  }
  return null;
}

async function getTranscript(): Promise<string | null> {
  // Already open (user opened it, or a prior run did)? Read it directly.
  const open = readSegments();
  if (open) return open;

  // The transcript button often hides until the description is expanded.
  document
    .querySelector<HTMLElement>(
      "ytd-text-inline-expander #expand, tp-yt-paper-button#expand, #description #expand",
    )
    ?.click();
  await sleep(300);

  const button = findShowTranscriptButton();
  if (!button) return null;
  button.click();

  // Segments render asynchronously; poll until they appear or we give up.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(200);
    const text = readSegments();
    if (text) return text;
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as { type?: string })?.type === "GET_TRANSCRIPT") {
    void getTranscript().then((transcript) => sendResponse({ transcript }));
    return true; // keep the channel open for the async response
  }
  return false;
});

export {};
