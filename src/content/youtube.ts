/**
 * Runs on youtube.com watch pages. On request from the background worker it
 * extracts the video's transcript by driving YouTube's own "Show transcript"
 * panel and reading the rendered lines.
 *
 * Why the DOM instead of fetching the caption file: as of 2026 YouTube's
 * timedtext endpoint requires a proof-of-origin (PO) token and returns an
 * empty body without it, so a plain fetch — even from the extension with the
 * user's cookies — yields nothing. The transcript panel works because the page
 * itself mints the token and paints the lines into the DOM; we just read them.
 *
 * Two panel generations exist in the wild: the classic
 * `ytd-transcript-segment-renderer` list, and the newer "modern_transcript_view"
 * (a `yt-section-list-renderer` that scrolls and may virtualize its rows). We
 * handle both. Logs are prefixed [TL;DW] for diagnosing in the page console.
 *
 * This only sees the currently-loaded video, so a right-clicked thumbnail gets
 * no transcript — the background worker handles that.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log("[TL;DW]", ...args);

const TIMESTAMP_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const PANEL_CHROME = /^(transcript|timeline|search transcript|in this video)$/i;

// --- classic panel: discrete segment elements ----------------------------

const CLASSIC_SELECTORS = [
  "ytd-transcript-segment-renderer",
  "ytd-transcript-segment-list-renderer .segment",
];

function readClassicSegments(): string | null {
  for (const selector of CLASSIC_SELECTORS) {
    const segments = document.querySelectorAll(selector);
    if (segments.length === 0) continue;
    const lines: string[] = [];
    segments.forEach((segment) => {
      const text =
        segment.querySelector(".segment-text")?.textContent?.trim() ??
        segment.textContent?.replace(/^\s*\d+:\d+(?::\d+)?\s*/, "").trim();
      if (text) lines.push(text);
    });
    if (lines.length > 0) return lines.join(" ").replace(/\s+/g, " ").trim();
  }
  return null;
}

// --- modern panel: scrollable yt-section-list-renderer -------------------

/** The visible, scrollable list host of the modern transcript panel. */
function findModernHost(): HTMLElement | null {
  const hosts = document.querySelectorAll<HTMLElement>(
    '[data-target-id*="transcript" i]',
  );
  for (const host of hosts) {
    if (host.offsetParent !== null && host.scrollHeight > 0) return host;
  }
  return document.querySelector<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[visibility*="EXPANDED"] #content',
  );
}

/** Keep only spoken-text lines, dropping bare timestamps and panel chrome. */
function harvest(host: HTMLElement, seen: Set<string>, lines: string[]): void {
  for (const raw of host.innerText.split("\n")) {
    const line = raw.trim();
    if (!line || TIMESTAMP_ONLY.test(line) || PANEL_CHROME.test(line)) continue;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
}

/**
 * Read the modern panel, scrolling through it so a virtualized list yields all
 * of its rows rather than just the handful currently painted.
 */
async function readModernTranscript(): Promise<string | null> {
  const host = findModernHost();
  if (!host) return null;

  const seen = new Set<string>();
  const lines: string[] = [];
  harvest(host, seen, lines);

  let lastTop = -1;
  while (host.scrollTop !== lastTop) {
    lastTop = host.scrollTop;
    host.scrollTop = host.scrollTop + host.clientHeight;
    await sleep(120);
    harvest(host, seen, lines);
    if (host.scrollTop + host.clientHeight >= host.scrollHeight - 2) {
      await sleep(120);
      harvest(host, seen, lines);
      break;
    }
  }

  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 20 ? text : null;
}

async function readTranscript(): Promise<string | null> {
  return readClassicSegments() ?? (await readModernTranscript());
}

// --- opening the panel ----------------------------------------------------

function expandDescription(): void {
  const expander = document.querySelector<HTMLElement>(
    "ytd-text-inline-expander #expand, tp-yt-paper-button#expand, #description #expand, #expand",
  );
  if (expander) {
    log("expanding description");
    expander.click();
  }
}

function findShowTranscriptButton(): HTMLElement | null {
  const section = document.querySelector(
    "ytd-video-description-transcript-section-renderer",
  );
  const sectionBtn = section?.querySelector<HTMLElement>("button");
  if (sectionBtn) return sectionBtn;

  for (const el of document.querySelectorAll<HTMLElement>("button[aria-label]")) {
    if (/transcript/i.test(el.getAttribute("aria-label") ?? "")) return el;
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    "button, ytd-button-renderer, tp-yt-paper-button, yt-button-shape",
  )) {
    if (/^show transcript$/i.test(el.textContent?.trim() ?? "")) return el;
  }
  return null;
}

async function getTranscript(): Promise<string | null> {
  const already = await readTranscript();
  if (already) {
    log("transcript already open:", already.length, "chars");
    return already;
  }

  expandDescription();

  let button: HTMLElement | null = null;
  const buttonDeadline = Date.now() + 4000;
  while (Date.now() < buttonDeadline) {
    button = findShowTranscriptButton();
    if (button) break;
    await sleep(200);
  }
  if (!button) {
    log("no 'Show transcript' button — does this video have captions?");
    return null;
  }
  log("clicking 'Show transcript'");
  button.click();

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(300);
    const text = await readTranscript();
    if (text) {
      log("transcript captured:", text.length, "chars");
      return text;
    }
  }
  log("transcript panel opened but no lines were read");
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
