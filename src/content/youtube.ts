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

// Serialises concurrent calls so only one panel-open attempt runs at a time.
let activeTranscriptFetch: Promise<string | null> | null = null;

async function getTranscript(): Promise<string | null> {
  const immediate = available();
  if (immediate) {
    log("transcript ready:", immediate.length, "chars");
    return immediate;
  }

  if (activeTranscriptFetch) return activeTranscriptFetch;

  activeTranscriptFetch = (async () => {
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
  })();

  try {
    return await activeTranscriptFetch;
  } finally {
    activeTranscriptFetch = null;
  }
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

function ensureShimmerStyle(): void {
  if (document.getElementById("tldw-shimmer-style")) return;
  const s = document.createElement("style");
  s.id = "tldw-shimmer-style";
  s.textContent = "@keyframes tldw-shimmer{0%,100%{opacity:0.35}50%{opacity:0.75}}";
  document.head.appendChild(s);
}

function panelHost(): Element | null {
  return (
    document.querySelector("#below") ??
    document.querySelector("ytd-watch-metadata") ??
    document.querySelector("#secondary-inner") ??
    document.querySelector("#secondary")
  );
}

/** Show an instant skeleton panel while the API call is in flight. */
function showLoadingPanel(): void {
  const host = panelHost();
  if (!host) return;
  removeSummaryPanel();
  ensureShimmerStyle();

  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
  });

  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" });

  const headIcon = document.createElement("img");
  headIcon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(headIcon.style, { width: "28px", height: "28px", borderRadius: "6px", flexShrink: "0" });

  const titleEl = document.createElement("span");
  titleEl.textContent = "TL;DW";
  Object.assign(titleEl.style, { fontWeight: "700", fontSize: "15px", color: t.text });

  const analyzing = document.createElement("span");
  analyzing.textContent = "Analyzing…";
  Object.assign(analyzing.style, { fontSize: "12px", color: t.sub, animation: "tldw-shimmer 1.4s infinite" });

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  head.append(headIcon, titleEl, spacer, analyzing);

  const shimmerLine = (width: string) => {
    const d = document.createElement("div");
    Object.assign(d.style, {
      background: t.border, borderRadius: "4px", height: "13px",
      width, marginBottom: "8px", animation: "tldw-shimmer 1.4s infinite",
    });
    return d;
  };

  panel.append(head, shimmerLine("90%"), shimmerLine("65%"));
  summaryPanel = panel;
  host.prepend(panel);
  log("loading panel shown");
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

  // --- header row ---
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" });

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

  const headChildren: HTMLElement[] = [headIcon, titleEl, verdictPill, ratingPill, spacer];
  if (tldw.source) {
    const srcBtn = document.createElement("button");
    srcBtn.textContent = `⚡ ${tldw.source}`;
    Object.assign(srcBtn.style, {
      fontSize: "11px", color: t.sub, background: "transparent", border: "none",
      cursor: "pointer", padding: "0", textDecoration: "underline",
      textUnderlineOffset: "2px", whiteSpace: "nowrap", marginRight: "2px",
    });
    srcBtn.title = "Open Direct API settings";
    srcBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    });
    headChildren.push(srcBtn);
  }
  headChildren.push(closeBtn);
  head.append(...headChildren);

  // --- body: summary always visible; clicking it toggles details if present ---
  const hasDetails = !!tldw.details;

  const body = document.createElement("div");
  if (hasDetails) {
    Object.assign(body.style, { cursor: "pointer", userSelect: "none" });
  }

  const summaryRow = document.createElement("div");
  Object.assign(summaryRow.style, { display: "flex", alignItems: "flex-start", gap: "6px" });

  const summaryEl = document.createElement("div");
  summaryEl.textContent = tldw.summary;
  Object.assign(summaryEl.style, { fontSize: "13px", lineHeight: "1.5", color: t.text, flex: "1" });
  summaryRow.append(summaryEl);

  body.append(summaryRow);

  if (hasDetails) {
    const chevron = document.createElement("span");
    chevron.textContent = "▾";
    Object.assign(chevron.style, { fontSize: "11px", color: t.sub, flexShrink: "0", marginTop: "3px" });
    summaryRow.append(chevron);

    const detailsWrap = document.createElement("div");
    Object.assign(detailsWrap.style, {
      display: "grid", gridTemplateRows: "0fr",
      overflow: "hidden", transition: "grid-template-rows 0.2s ease",
    });
    const detailsInner = document.createElement("div");
    detailsInner.textContent = tldw.details!;
    Object.assign(detailsInner.style, {
      overflow: "hidden", paddingTop: "8px",
      fontSize: "13px", lineHeight: "1.55", color: t.sub,
    });
    detailsWrap.append(detailsInner);
    body.append(detailsWrap);

    let expanded = false;
    body.addEventListener("click", () => {
      expanded = !expanded;
      detailsWrap.style.gridTemplateRows = expanded ? "1fr" : "0fr";
      chevron.textContent = expanded ? "▴" : "▾";
      body.style.opacity = "1";
    });
    body.addEventListener("mouseenter", () => { body.style.opacity = "0.8"; });
    body.addEventListener("mouseleave", () => { body.style.opacity = "1"; });
  }

  panel.append(head, body);
  return panel;
}

function showSummaryPanel(tldw: TldwSummary): void {
  const host = panelHost();
  if (!host) return;
  removeSummaryPanel();
  summaryPanel = buildSummaryPanel(tldw);
  host.prepend(summaryPanel);
  log("summary panel injected");
}

// --- auto TL;DW ----------------------------------------------------------

const autoRunVideoIds = new Set<string>();

/**
 * Direct API path: fires immediately on navigation — shows a loading skeleton
 * right away and pre-fetches the transcript in parallel so the user sees
 * something instantly rather than waiting 2.5 s for the video duration check.
 */
async function maybeStartDirectApiRun(): Promise<void> {
  const vid = currentVideoId();
  if (!vid || autoRunVideoIds.has(vid) || summaryPanel) return;

  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as Record<string, unknown> | undefined;
  if (!(s?.useDirectApi as boolean) || !(s?.geminiApiKey as string)) return;

  autoRunVideoIds.add(vid);
  showLoadingPanel();
  void getTranscript(); // pre-fetch so it's cached when the background asks
  log("direct API auto-run started");
  try {
    await chrome.runtime.sendMessage({ type: "ASK" });
  } catch {
    /* best effort */
  }
}

/**
 * Threshold path: waits 2500ms so the video element has its duration, then
 * runs for videos over the configured length (opens a tab — not headless).
 */
async function autoRunIfLong(): Promise<void> {
  const vid = currentVideoId();
  if (!vid || autoRunVideoIds.has(vid) || summaryPanel) return;

  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as Record<string, unknown> | undefined;
  const threshold = (s?.autoTldwMinutes as number) ?? 0;
  if (!threshold) return;

  const { durationSeconds } = getVideoMeta();
  if (!durationSeconds || durationSeconds / 60 < threshold) return;

  autoRunVideoIds.add(vid);
  log("auto-running TL;DW for", Math.round(durationSeconds / 60), "min video");
  try {
    await chrome.runtime.sendMessage({ type: "ASK" });
  } catch {
    /* best effort */
  }
}

window.addEventListener("yt-navigate-finish", () => {
  removeSummaryPanel();
  activeTranscriptFetch = null; // reset lock for new video
  void maybeStartDirectApiRun();                    // immediate: loading panel + API
  setTimeout(() => { void autoRunIfLong(); }, 2500); // deferred: needs video duration
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
