/**
 * Runs on youtube.com watch pages (isolated world). It obtains the current
 * video's transcript and hands it to the background worker on request.
 *
 * Primary path: the MAIN-world interceptor (youtube-intercept.ts) wraps the
 * page's fetch and relays YouTube's own transcript responses here via
 * postMessage. We cache that. To make YouTube actually issue the request we
 * open its "Show transcript" panel — but we read the intercepted *data*, not
 * the rendered panel, so it survives UI redesigns, shadow DOM, virtualization,
 * and other extensions mutating the panel.
 *
 * Fallback path: if nothing is intercepted, we scrape whatever the panel
 * rendered (classic or modern markup).
 *
 * Only the currently-loaded video is visible here, so a right-clicked thumbnail
 * gets no transcript — the background worker handles that.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log("[TL;DW]", ...args);

const currentVideoId = (): string | null =>
  new URLSearchParams(location.search).get("v");

// --- intercepted transcript cache ----------------------------------------

let captured: string | null = null;
let capturedVideoId: string | null = null;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as
    | { __tldw?: boolean; kind?: string; body?: unknown }
    | undefined;
  if (!data || data.__tldw !== true) return;

  const text =
    data.kind === "get_transcript"
      ? extractFromGetTranscript(data.body)
      : data.kind === "timedtext"
        ? extractFromTimedText(data.body)
        : null;

  if (text) {
    captured = text;
    capturedVideoId = currentVideoId();
    log("intercepted transcript:", text.length, "chars");
  }
});

function cachedForCurrentVideo(): string | null {
  return captured && capturedVideoId === currentVideoId() ? captured : null;
}

// --- parsing YouTube's transcript payloads -------------------------------

type SnippetLike = { simpleText?: string; runs?: { text?: string }[] };

function snippetText(snippet: SnippetLike | undefined): string {
  if (typeof snippet?.simpleText === "string") return snippet.simpleText;
  if (Array.isArray(snippet?.runs)) {
    return snippet.runs.map((r) => r?.text ?? "").join("");
  }
  return "";
}

/** Walk the get_transcript InnerTube JSON, collecting every segment's text. */
function extractFromGetTranscript(root: unknown): string | null {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const seg = record.transcriptSegmentRenderer as
      | { snippet?: SnippetLike }
      | undefined;
    if (seg?.snippet) {
      const text = snippetText(seg.snippet);
      if (text) parts.push(text);
    }
    for (const key in record) visit(record[key]);
  };
  visit(root);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 20 ? text : null;
}

/** Parse a timedtext response — either json3 or the legacy XML. */
function extractFromTimedText(body: unknown): string | null {
  if (typeof body !== "string" || !body) return null;

  if (body.trimStart().startsWith("{")) {
    try {
      const json = JSON.parse(body) as {
        events?: { segs?: { utf8?: string }[] }[];
      };
      const text = (json.events ?? [])
        .flatMap((e) => e.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      return text.length > 20 ? text : null;
    } catch {
      return null;
    }
  }

  const parts: string[] = [];
  for (const m of body.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    parts.push(decodeEntities(m[1]));
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 20 ? text : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// --- opening the panel (to trigger YouTube's fetch) ----------------------

function expandDescription(): void {
  document
    .querySelector<HTMLElement>(
      "ytd-text-inline-expander #expand, tp-yt-paper-button#expand, #description #expand, #expand",
    )
    ?.click();
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

// --- DOM scrape fallback --------------------------------------------------

function joinLines(lines: string[]): string | null {
  if (lines.length === 0) return null;
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** Strip a leading "1:23" / "1:02:03" timestamp from a segment's text. */
function stripTimestamp(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim();
}

function scrapeRenderedTranscript(): string | null {
  // Modern view-model panel (transcript-segment-view-model). The whole
  // transcript renders at once, so one query gets every line.
  const modern = document.querySelectorAll(
    "transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost",
  );
  if (modern.length > 0) {
    const lines: string[] = [];
    modern.forEach((seg) => {
      const text = stripTimestamp(seg.textContent ?? "");
      if (text) lines.push(text);
    });
    const joined = joinLines(lines);
    if (joined) return joined;
  }

  // Classic discrete segment elements.
  for (const selector of [
    "ytd-transcript-segment-renderer",
    "ytd-transcript-segment-list-renderer .segment",
  ]) {
    const segments = document.querySelectorAll(selector);
    if (segments.length === 0) continue;
    const lines: string[] = [];
    segments.forEach((segment) => {
      const text =
        segment.querySelector(".segment-text")?.textContent?.trim() ??
        stripTimestamp(segment.textContent ?? "");
      if (text) lines.push(text);
    });
    const joined = joinLines(lines);
    if (joined) return joined;
  }
  return null;
}

// --- request handling -----------------------------------------------------

/** Either source: intercepted network data, or the rendered panel. */
function available(): string | null {
  return cachedForCurrentVideo() ?? scrapeRenderedTranscript();
}

/** The transcript engagement panel element, if present. */
function transcriptPanelEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
  );
}

/** Whether YouTube's transcript panel is currently open. */
function transcriptPanelOpen(): boolean {
  const panel = transcriptPanelEl();
  if (panel) {
    return panel.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
  }
  const seg = document.querySelector<HTMLElement>("ytd-transcript-segment-renderer");
  return !!(seg && seg.offsetParent !== null);
}

/** Collapse the transcript panel (best-effort) — used to undo a panel we opened. */
function closeTranscriptPanel(): void {
  const panel = transcriptPanelEl();
  const closeBtn =
    panel?.querySelector<HTMLElement>("#visibility-button button") ??
    panel?.querySelector<HTMLElement>('button[aria-label*="lose" i]') ??
    null;
  if (closeBtn) {
    log("closing transcript panel we opened");
    closeBtn.click();
    return;
  }
  findShowTranscriptButton()?.click();
}

/**
 * Open YouTube's transcript panel so its segments render (and any fetch fires).
 * Returns whether *we* opened it, so the caller can close it again afterward
 * without disturbing a panel the user had already open.
 */
async function openTranscriptPanel(): Promise<{ openedByUs: boolean }> {
  if (transcriptPanelOpen()) return { openedByUs: false };
  expandDescription();
  let button: HTMLElement | null = null;
  const buttonDeadline = Date.now() + 4000;
  while (Date.now() < buttonDeadline) {
    button = findShowTranscriptButton();
    if (button) break;
    await sleep(200);
  }
  if (button) {
    log("opening transcript panel");
    button.click();
    return { openedByUs: true };
  }
  log("no 'Show transcript' button found");
  return { openedByUs: false };
}

async function getTranscript(): Promise<string | null> {
  const immediate = available();
  if (immediate) {
    log("transcript ready:", immediate.length, "chars");
    return immediate;
  }

  const { openedByUs } = await openTranscriptPanel();

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(300);
    const hit = available();
    if (hit) {
      if (openedByUs) closeTranscriptPanel();
      log("transcript captured:", hit.length, "chars");
      return hit;
    }
  }

  if (openedByUs) closeTranscriptPanel();
  log("no transcript captured");
  return null;
}

/** Parse "12:34" / "1:02:03" into seconds. */
function hmsToSeconds(text: string | null | undefined): number {
  if (!text) return 0;
  const parts = text.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Read the current video's duration (seconds) and channel name. */
function getVideoMeta(): { durationSeconds: number; channel: string } {
  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
  let durationSeconds =
    video && Number.isFinite(video.duration) ? video.duration : 0;
  if (!durationSeconds) {
    durationSeconds = hmsToSeconds(
      document.querySelector(".ytp-time-duration")?.textContent,
    );
  }
  const channel =
    document
      .querySelector(
        "ytd-channel-name a, #owner #channel-name a, ytd-video-owner-renderer a.yt-simple-endpoint",
      )
      ?.textContent?.trim() ?? "";
  return { durationSeconds, channel };
}

// --- TL;DW summary panel -------------------------------------------------

type TldwSummary = { verdict: string; summary: string; rating: string; details?: string; source?: string };

let summaryPanel: HTMLElement | null = null;

function removeSummaryPanel(): void {
  summaryPanel?.remove();
  summaryPanel = null;
}

function theme(): { bg: string; border: string; text: string; sub: string; hover: string } {
  const dark = document.documentElement.hasAttribute("dark");
  return dark
    ? { bg: "#212121", border: "#3f3f3f", text: "#f1f1f1", sub: "#aaaaaa", hover: "#383838" }
    : { bg: "#ffffff", border: "#e5e5e5", text: "#0f0f0f", sub: "#606060", hover: "#f2f2f2" };
}

function verdictColor(verdict: string): string {
  if (verdict === "SKIP") return "#dc2626";
  if (verdict === "SKIM") return "#d97706";
  return "#16a34a"; // WATCH
}

function pill(text: string, bg: string, color: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = text;
  Object.assign(el.style, {
    background: bg,
    color,
    fontWeight: "700",
    fontSize: "11px",
    letterSpacing: "0.05em",
    padding: "3px 9px",
    borderRadius: "999px",
    flexShrink: "0",
    whiteSpace: "nowrap",
  });
  return el;
}

function buildSummaryPanel(tldw: TldwSummary): HTMLElement {
  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg,
    border: `1px solid ${t.border}`,
    borderRadius: "12px",
    padding: "10px 14px",
    marginTop: "12px",
    marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
    color: t.text,
  });

  // --- single header row: icon · TL;DW · verdict pill · rating pill · spacer · close ---
  const head = document.createElement("div");
  Object.assign(head.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
  });

  const headIcon = document.createElement("img");
  headIcon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(headIcon.style, { width: "28px", height: "28px", borderRadius: "6px", flexShrink: "0" });

  const titleEl = document.createElement("span");
  titleEl.textContent = "TL;DW";
  Object.assign(titleEl.style, { fontWeight: "700", fontSize: "15px" });

  const verdictPill = pill(tldw.verdict, verdictColor(tldw.verdict), "#fff");

  const ratingPill = pill(tldw.rating, t.border, t.text);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const closeBtn = document.createElement("button");
  Object.assign(closeBtn.style, {
    background: "transparent", border: "none", color: t.sub,
    cursor: "pointer", fontSize: "14px", lineHeight: "1",
    padding: "4px 6px", borderRadius: "6px", flexShrink: "0",
  });
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Hide TL;DW");
  closeBtn.addEventListener("mouseenter", () => (closeBtn.style.background = t.hover));
  closeBtn.addEventListener("mouseleave", () => (closeBtn.style.background = "transparent"));
  closeBtn.addEventListener("click", removeSummaryPanel);

  const children: (HTMLElement | Text)[] = [headIcon, titleEl, verdictPill, ratingPill, spacer];
  if (tldw.source) {
    const srcTag = document.createElement("span");
    srcTag.textContent = `⚡ ${tldw.source}`;
    Object.assign(srcTag.style, { fontSize: "11px", color: t.sub, whiteSpace: "nowrap", marginRight: "4px" });
    children.push(srcTag);
  }
  children.push(closeBtn);
  head.append(...children);

  // --- summary sentence ---
  const summaryEl = document.createElement("div");
  summaryEl.textContent = tldw.summary;
  Object.assign(summaryEl.style, { fontSize: "13px", lineHeight: "1.5", color: t.text });

  panel.append(head, summaryEl);

  // --- expandable details section ---
  if (tldw.details) {
    const detailsWrap = document.createElement("div");
    Object.assign(detailsWrap.style, {
      display: "grid",
      gridTemplateRows: "0fr",
      overflow: "hidden",
      transition: "grid-template-rows 0.22s ease",
    });
    const detailsInner = document.createElement("div");
    detailsInner.textContent = tldw.details;
    Object.assign(detailsInner.style, {
      overflow: "hidden",
      paddingTop: "8px",
      fontSize: "13px",
      lineHeight: "1.55",
      color: t.sub,
    });
    detailsWrap.append(detailsInner);

    let expanded = false;
    const detailsBtn = document.createElement("button");
    detailsBtn.textContent = "▾ Details";
    Object.assign(detailsBtn.style, {
      background: "transparent", border: "none", color: t.sub,
      cursor: "pointer", fontSize: "12px", padding: "6px 0 0",
      display: "block", textAlign: "left",
    });
    detailsBtn.addEventListener("mouseenter", () => (detailsBtn.style.color = t.text));
    detailsBtn.addEventListener("mouseleave", () => (detailsBtn.style.color = t.sub));
    detailsBtn.addEventListener("click", () => {
      expanded = !expanded;
      detailsWrap.style.gridTemplateRows = expanded ? "1fr" : "0fr";
      detailsBtn.textContent = expanded ? "▴ Details" : "▾ Details";
    });

    panel.append(detailsBtn, detailsWrap);
  }

  return panel;
}

function showSummaryPanel(tldw: TldwSummary): void {
  const host =
    document.querySelector("#below") ??
    document.querySelector("ytd-watch-metadata") ??
    document.querySelector("#secondary-inner") ??
    document.querySelector("#secondary");
  if (!host) return;
  removeSummaryPanel();
  summaryPanel = buildSummaryPanel(tldw);
  host.prepend(summaryPanel);
  log("summary panel injected");
}

// --- auto TL;DW for long videos ------------------------------------------

const autoRunVideoIds = new Set<string>();

async function autoRunIfLong(): Promise<void> {
  const vid = currentVideoId();
  // Don't run if: no video ID, already ran for this video, or panel already showing.
  if (!vid || autoRunVideoIds.has(vid) || summaryPanel) return;

  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as Record<string, unknown> | undefined;
  const threshold = (s?.autoTldwMinutes as number) ?? 0;
  const useDirectApi = !!(s?.useDirectApi as boolean);
  const hasKey = !!(s?.geminiApiKey as string);

  // Direct API enabled: auto-run headlessly on every video (no duration threshold).
  // Classic auto-TL;DW: run when video exceeds the configured threshold.
  const isDirectAutoRun = useDirectApi && hasKey;
  const { durationSeconds } = getVideoMeta();
  const isLongVideoRun = threshold > 0 && durationSeconds > 0 && durationSeconds / 60 >= threshold;

  if (!isDirectAutoRun && !isLongVideoRun) return;

  autoRunVideoIds.add(vid);
  log("auto-running TL;DW", isDirectAutoRun ? "(direct API)" : `(${Math.round(durationSeconds / 60)} min video)`);
  try {
    await chrome.runtime.sendMessage({ type: "ASK" });
  } catch {
    /* best effort */
  }
}

// Remove a stale panel when the user navigates to another video; also check auto-run.
window.addEventListener("yt-navigate-finish", () => {
  removeSummaryPanel();
  // Small delay so the video element has loaded its duration.
  setTimeout(() => { void autoRunIfLong(); }, 2500);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === "GET_TRANSCRIPT") {
    log("transcript requested");
    void getTranscript().then((transcript) => sendResponse({ transcript }));
    return true;
  }
  if (type === "PAUSE_VIDEO") {
    const video = document.querySelector<HTMLVideoElement>(
      "video.html5-main-video, video",
    );
    video?.pause();
    sendResponse({ paused: !!video });
    return false;
  }
  if (type === "GET_VIDEO_META") {
    sendResponse(getVideoMeta());
    return false;
  }
  if (type === "SET_SUMMARY") {
    const msg = message as { tldw?: TldwSummary; source?: string };
    const tldw = msg?.tldw;
    if (tldw?.verdict && tldw.summary) {
      showSummaryPanel({ ...tldw, source: msg.source });
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

export {};
