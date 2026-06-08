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

/** Read the current video's duration (seconds), channel name, and channel avatar URL. */
function getVideoMeta(): { durationSeconds: number; channel: string; avatarUrl?: string } {
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
  const avatarUrl =
    document.querySelector<HTMLImageElement>(
      "ytd-video-owner-renderer #avatar img, #owner yt-img-shadow img, ytd-video-owner-renderer yt-img-shadow img",
    )?.src ?? undefined;
  return { durationSeconds, channel, avatarUrl };
}

// --- comment scraping ----------------------------------------------------

/**
 * Scrolls the comments section into view, waits up to 2 s for comment
 * elements to render, and returns up to 20 comments as a formatted string.
 * Returns null if no comments are found within the timeout.
 */
async function getTopComments(): Promise<string | null> {
  const commentsEl = document.querySelector<HTMLElement>("ytd-comments#comments");
  if (!commentsEl) return null;

  // Scroll into view to trigger YouTube's lazy comment load.
  commentsEl.scrollIntoView({ behavior: "instant", block: "start" });

  // Poll for comment thread renderers up to 5 s.
  const deadline = Date.now() + 5000;
  let threads: NodeListOf<Element> | null = null;
  while (Date.now() < deadline) {
    threads = document.querySelectorAll("ytd-comment-thread-renderer");
    if (threads.length > 0) break;
    await sleep(100);
  }

  // Scroll back to top so the user isn't disoriented.
  window.scrollTo({ top: 0, behavior: "instant" });

  if (!threads || threads.length === 0) return null;

  const comments: string[] = [];
  const limit = Math.min(threads.length, 20);
  for (let i = 0; i < limit; i++) {
    const thread = threads[i];
    const textEl =
      thread.querySelector<HTMLElement>("#content-text") ??
      thread.querySelector<HTMLElement>("yt-attributed-string") ??
      thread.querySelector<HTMLElement>(".ytd-comment-renderer");
    const text = textEl?.textContent?.trim().replace(/\s+/g, " ");
    if (!text) continue;

    const likeEl =
      thread.querySelector<HTMLElement>("#vote-count-middle") ??
      thread.querySelector<HTMLElement>("span[aria-label]");
    const likes = likeEl?.textContent?.trim();
    comments.push(likes ? `${text} [${likes} likes]` : text);
  }

  return comments.length > 0 ? comments.join("\n") : null;
}

// --- auto-run / blocked channel helpers (direct storage; no lib imports in content script) --

const AUTO_RUN_CHANNELS_KEY = "autoRunChannels";
const BLOCKED_CHANNELS_KEY = "tldwBlockedChannels";
const BLOCKED_COMMENTS_KEY = "tldwBlockedCommentsChannels";
const TLDW_COMMENTS_PANEL_ID = "tldw-comments-panel";

type AutoRunChannelEntry = {
  id: string; name: string; avatarUrl: string; addedAt: string;
  autoRunSummary: boolean; autoRunComments: boolean;
};

type BlockedChannelEntry = { id: string; name: string; avatarUrl: string; addedAt: string };

async function readBlockedChannels(): Promise<BlockedChannelEntry[]> {
  const r = await chrome.storage.local.get(BLOCKED_CHANNELS_KEY);
  return (r[BLOCKED_CHANNELS_KEY] as BlockedChannelEntry[]) ?? [];
}

async function addBlockedChannelEntry(info: ChannelInfo): Promise<void> {
  const existing = await readBlockedChannels();
  const filtered = existing.filter((c) => c.id !== info.id && c.name !== info.name);
  const entry: BlockedChannelEntry = { ...info, addedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [BLOCKED_CHANNELS_KEY]: [entry, ...filtered] });
}

async function addBlockedCommentsChannelEntry(info: ChannelInfo): Promise<void> {
  const r = await chrome.storage.local.get(BLOCKED_COMMENTS_KEY);
  const existing = (r[BLOCKED_COMMENTS_KEY] as BlockedChannelEntry[]) ?? [];
  const filtered = existing.filter((c) => c.id !== info.id && c.name !== info.name);
  const entry: BlockedChannelEntry = { ...info, addedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [BLOCKED_COMMENTS_KEY]: [entry, ...filtered] });
}

async function readAutoRunChannels(): Promise<AutoRunChannelEntry[]> {
  const r = await chrome.storage.local.get(AUTO_RUN_CHANNELS_KEY);
  const raw = (r[AUTO_RUN_CHANNELS_KEY] as Partial<AutoRunChannelEntry>[]) ?? [];
  return raw.map((c) => ({ autoRunSummary: true, autoRunComments: false, ...c } as AutoRunChannelEntry));
}

async function writeAutoRunChannel(info: ChannelInfo, field: "summary" | "comments", enable: boolean): Promise<void> {
  const channels = await readAutoRunChannels();
  const existing = channels.find((c) => c.id === info.id || c.name === info.name);
  let updated: AutoRunChannelEntry[];
  if (existing) {
    const patched: AutoRunChannelEntry = {
      ...existing,
      avatarUrl: info.avatarUrl, // refresh avatar on each visit
      autoRunSummary: field === "summary" ? enable : existing.autoRunSummary,
      autoRunComments: field === "comments" ? enable : existing.autoRunComments,
    };
    if (!patched.autoRunSummary && !patched.autoRunComments) {
      updated = channels.filter((c) => c.id !== existing.id);
    } else {
      updated = channels.map((c) => (c.id === existing.id ? patched : c));
    }
  } else if (enable) {
    updated = [{
      id: info.id, name: info.name, avatarUrl: info.avatarUrl,
      addedAt: new Date().toISOString(),
      autoRunSummary: field === "summary",
      autoRunComments: field === "comments",
    }, ...channels];
  } else {
    updated = channels;
  }
  await chrome.storage.local.set({ [AUTO_RUN_CHANNELS_KEY]: updated });
}

// --- channel info extracted from the page ------------------------------------

type ChannelInfo = { id: string; name: string; avatarUrl: string };

/** Extract channel handle/ID, display name, and avatar from the current watch page. */
function getChannelInfo(): ChannelInfo | null {
  const anchor = document.querySelector<HTMLAnchorElement>(
    "ytd-channel-name a, #owner #channel-name a, ytd-video-owner-renderer a.yt-simple-endpoint",
  );
  if (!anchor) return null;
  const name = anchor.textContent?.trim() ?? "";
  if (!name) return null;
  const href = anchor.getAttribute("href") ?? "";
  const id = href.startsWith("/") ? href : `/@${name}`;
  const avatarUrl =
    document.querySelector<HTMLImageElement>(
      "ytd-video-owner-renderer #avatar img, #owner yt-img-shadow img, ytd-video-owner-renderer yt-img-shadow img",
    )?.src ?? "";
  return { id, name, avatarUrl };
}

// Module-level state so the SET_SUMMARY handler can use the same channel context
// as the initial maybeStartDirectApiRun call.
let currentChannelInfo: ChannelInfo | null = null;
let currentAutoRunSummary = false;
let currentAutoRunComments = false;

// --- TL;DW summary panel -------------------------------------------------

type TldwSummary = { verdict: string; summary: string; rating: string; details?: string; source?: string };

let summaryPanel: HTMLElement | null = null;

function removeSummaryPanel(): void {
  summaryPanel?.remove();
  summaryPanel = null;
}

// --- TL;DW comments panel (injected into ytd-comments-header-renderer) ----

let commentsPanel: HTMLElement | null = null;
let commentsObserver: MutationObserver | null = null;
/** Pending sentiment to apply as soon as the comments section appears in the DOM. */
let pendingCommentSentiment: { sentiment: string; audienceScore?: number } | null = null;

function commentsHeaderHost(): Element | null {
  return document.querySelector("ytd-comments-header-renderer");
}

function removeCommentsPanel(): void {
  document.getElementById(TLDW_COMMENTS_PANEL_ID)?.remove();
  commentsPanel = null;
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

// --- auto-run pill toggle (shared by all panel states) -----------------------

/**
 * A small pill button in the panel header that shows/toggles auto-run state
 * for either summary or comments. Color reflects current state.
 */
function buildAutoToggle(
  info: ChannelInfo,
  field: "summary" | "comments",
  initialOn: boolean,
  t: ReturnType<typeof theme>,
): HTMLButtonElement {
  const label = field === "summary" ? "↻ Summary" : "💬 Comments";
  const onColor = field === "summary" ? "#1a73e8" : "#0d9488";

  const btn = document.createElement("button");
  btn.textContent = label;
  Object.assign(btn.style, {
    fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em",
    padding: "3px 8px", borderRadius: "999px", border: "none",
    cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
    transition: "background 0.15s, color 0.15s",
  });

  const applyState = (on: boolean) => {
    btn.style.background = on ? onColor : t.border;
    btn.style.color = on ? "#fff" : t.sub;
    btn.title = on
      ? `Auto-run ${field} enabled for ${info.name} — click to disable`
      : `Enable auto-run ${field} for ${info.name}`;
  };

  applyState(initialOn);

  let busy = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (busy) return;
    busy = true;
    const next = field === "summary" ? !currentAutoRunSummary : !currentAutoRunComments;
    if (field === "summary") currentAutoRunSummary = next;
    else currentAutoRunComments = next;
    applyState(next);
    void writeAutoRunChannel(info, field, next).finally(() => { busy = false; });
  });

  return btn;
}

/** Shared header row builder used by all panel states. */
function buildPanelHead(
  t: ReturnType<typeof theme>,
  controls: HTMLElement[],
  channelInfo: ChannelInfo | null,
  showBlockBtn = true,
): HTMLElement {
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "7px" });

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/tl-dw-32.png");
  Object.assign(icon.style, { width: "28px", height: "28px", borderRadius: "6px", flexShrink: "0" });

  const title = document.createElement("span");
  title.textContent = "TL;DW";
  Object.assign(title.style, { fontWeight: "700", fontSize: "15px", color: t.text, flexShrink: "0" });

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

  const autoToggles: HTMLElement[] = [];
  if (channelInfo) {
    autoToggles.push(buildAutoToggle(channelInfo, "summary", currentAutoRunSummary, t));
  }

  const blockBtn = (showBlockBtn && channelInfo) ? buildBlockButton(t, channelInfo) : null;
  head.append(icon, title, ...controls, spacer, ...autoToggles, ...(blockBtn ? [blockBtn] : []), closeBtn);
  return head;
}

/** Block button — hides the panel permanently for this channel on this and future visits. */
function buildBlockButton(t: ReturnType<typeof theme>, info: ChannelInfo): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = "⊘";
  btn.title = `Never show TL;DW panel for ${info.name}`;
  Object.assign(btn.style, {
    background: "transparent", border: "none", color: t.sub,
    cursor: "pointer", fontSize: "14px", lineHeight: "1",
    padding: "4px 6px", borderRadius: "6px", flexShrink: "0",
  });
  btn.addEventListener("mouseenter", () => { btn.style.background = t.hover; btn.style.color = "#dc2626"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; btn.style.color = t.sub; });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void addBlockedChannelEntry(info).then(() => {
      removeSummaryPanel();
      log("channel blocked:", info.name);
    });
  });
  return btn;
}

/** "Get Comment Analysis" button used in the result panel header until comments are loaded. */
function buildGetCommentsButton(t: ReturnType<typeof theme>): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = "Get Comment Analysis";
  Object.assign(btn.style, {
    fontSize: "12px", fontWeight: "600", letterSpacing: "0.02em",
    padding: "5px 12px", borderRadius: "999px",
    background: t.border, color: t.text,
    border: "none", cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
  });
  btn.title = "Analyze viewer comments";
  btn.addEventListener("mouseenter", () => { btn.style.background = t.hover; });
  btn.addEventListener("mouseleave", () => { btn.style.background = t.border; });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    btn.style.display = "none";
    try {
      void chrome.runtime.sendMessage({ type: "ASK_COMMENTS" });
    } catch { /* best effort */ }
  });
  return btn;
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

  const analyzing = document.createElement("span");
  analyzing.textContent = "Analyzing…";
  Object.assign(analyzing.style, { fontSize: "12px", color: t.sub, animation: "tldw-shimmer 1.4s infinite" });

  const head = buildPanelHead(t, [analyzing], currentChannelInfo);
  Object.assign(head.style, { marginBottom: "10px" });

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

type ChannelComparison = { avgAiRating: number | null; avgAudienceScore: number | null; count: number };

function buildSummaryPanel(
  tldw: TldwSummary,
  channelStats?: ChannelComparison,
  initialUserRating?: "watch" | "skim" | "skip",
  videoId?: string | null,
): HTMLElement {
  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif", color: t.text,
  });

  // --- header: verdict pill + source ---
  const verdictPill = pill(tldw.verdict, verdictColor(tldw.verdict), "#fff");

  const headerControls: HTMLElement[] = [verdictPill];

  if (tldw.source) {
    const srcBtn = document.createElement("button");
    srcBtn.textContent = `⚡ ${tldw.source}`;
    Object.assign(srcBtn.style, {
      fontSize: "11px", color: t.sub, background: "transparent", border: "none",
      cursor: "pointer", padding: "0", textDecoration: "underline",
      textUnderlineOffset: "2px", whiteSpace: "nowrap",
    });
    srcBtn.title = "Open Direct API settings";
    srcBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    });
    headerControls.push(srcBtn);
  }

  const head = buildPanelHead(t, headerControls, currentChannelInfo);
  Object.assign(head.style, { marginBottom: "8px" });

  // --- body: summary always visible; clicking it toggles details if present ---
  const hasDetails = !!tldw.details;
  const body = document.createElement("div");
  if (hasDetails) Object.assign(body.style, { cursor: "pointer", userSelect: "none" });

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

  // --- user personal rating row ---
  const ratingRow = buildUserRatingRow(t, initialUserRating, videoId);

  // --- channel comparison row (local math, no API call) ---
  const channelRow = document.createElement("div");
  if (channelStats && channelStats.count >= 1) {
    Object.assign(channelRow.style, {
      borderTop: `1px solid ${t.border}`,
      marginTop: "8px", paddingTop: "7px",
      fontSize: "12px", color: t.sub,
      display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center",
    });
    const fmt = (n: number | null) => n !== null ? n.toFixed(1) : "—";
    channelRow.innerHTML =
      `<span>📊 vs channel (${channelStats.count} videos)</span>` +
      (channelStats.avgAiRating !== null ? `<span>AI avg: ${fmt(channelStats.avgAiRating)}</span>` : "") +
      (channelStats.avgAudienceScore !== null ? `<span>Audience avg: ${fmt(channelStats.avgAudienceScore)}</span>` : "");
  }

  panel.append(
    head, body, ratingRow,
    ...(channelStats && channelStats.count >= 1 ? [channelRow] : []),
  );
  return panel;
}

/** WATCH / SKIM / SKIP personal rating row shown below the summary text. */
function buildUserRatingRow(
  t: ReturnType<typeof theme>,
  initial: "watch" | "skim" | "skip" | undefined,
  videoId: string | null | undefined,
): HTMLElement {
  const options: { value: "watch" | "skim" | "skip"; label: string; color: string }[] = [
    { value: "watch", label: "✓ Worth it", color: "#16a34a" },
    { value: "skim",  label: "~ OK",        color: "#d97706" },
    { value: "skip",  label: "✗ Skip",      color: "#dc2626" },
  ];

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex", alignItems: "center", gap: "6px",
    borderTop: `1px solid ${t.border}`, marginTop: "8px", paddingTop: "7px",
  });

  const label = document.createElement("span");
  label.textContent = "Your take:";
  Object.assign(label.style, { fontSize: "11px", color: t.sub, flexShrink: "0", marginRight: "2px" });
  row.append(label);

  let selected = initial ?? null;

  const btns = options.map(({ value, label: btnLabel, color }) => {
    const btn = document.createElement("button");
    btn.textContent = btnLabel;
    Object.assign(btn.style, {
      fontSize: "11px", fontWeight: "700", letterSpacing: "0.03em",
      padding: "3px 9px", borderRadius: "999px",
      border: "none", cursor: "pointer", flexShrink: "0", whiteSpace: "nowrap",
      transition: "background 0.12s, color 0.12s",
    });

    const applyState = (active: boolean) => {
      btn.style.background = active ? color : t.border;
      btn.style.color = active ? "#fff" : t.sub;
    };
    applyState(selected === value);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selected = value;
      btns.forEach((b, i) => b && applyState.call(null, options[i]!.value === value));
      // Persist to cache
      const vid = videoId ?? currentVideoId();
      if (vid) void chrome.storage.local.get("tldwSummaryCache").then((r) => {
        type SummaryCache = Record<string, { tldw: unknown; cachedAt: string; userRating?: string }>;
        const cache = (r["tldwSummaryCache"] as SummaryCache) ?? {};
        if (cache[vid]) {
          cache[vid]!.userRating = value;
          void chrome.storage.local.set({ tldwSummaryCache: cache });
        }
      });
    });

    row.append(btn);
    return btn;
  });

  // Closure captures `btns` for applyState cross-button updates
  btns.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      btns.forEach((b, j) => {
        b.style.background = j === i ? options[i]!.color : t.border;
        b.style.color = j === i ? "#fff" : t.sub;
      });
    });
  });

  return row;
}

function showSummaryPanel(
  tldw: TldwSummary,
  channelStats?: ChannelComparison,
  userRating?: "watch" | "skim" | "skip",
  videoId?: string | null,
): void {
  const host = panelHost();
  if (!host) return;

  removeSummaryPanel();
  const panel = buildSummaryPanel(tldw, channelStats, userRating, videoId ?? currentVideoId());
  summaryPanel = panel;
  host.prepend(summaryPanel);
  log("summary panel injected");
}

/** Show the idle panel — header with auto toggle, then an action row with Get Summary + Never. */
function showIdlePanel(onGetSummary: () => void): void {
  const host = panelHost();
  if (!host) return;
  removeSummaryPanel();

  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-summary";
  Object.assign(panel.style, {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    padding: "10px 14px", marginTop: "12px", marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
  });

  // Header — auto toggle and close; no block btn here (it's in the action row)
  const head = buildPanelHead(t, [], currentChannelInfo, false);
  Object.assign(head.style, { marginBottom: "10px" });

  // Action row
  const actionRow = document.createElement("div");
  Object.assign(actionRow.style, { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" });

  const summaryBtn = document.createElement("button");
  summaryBtn.textContent = "Get Summary";
  Object.assign(summaryBtn.style, {
    fontSize: "13px", fontWeight: "600",
    padding: "7px 18px", borderRadius: "999px",
    background: "#1a73e8", color: "#fff",
    border: "none", cursor: "pointer", whiteSpace: "nowrap",
  });
  summaryBtn.title = "Get AI summary of this video's transcript";
  summaryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeSummaryPanel();
    onGetSummary();
  });

  const neverBtn = document.createElement("button");
  neverBtn.textContent = "Never";
  Object.assign(neverBtn.style, {
    fontSize: "12px", fontWeight: "600",
    padding: "7px 14px", borderRadius: "999px",
    background: "transparent", color: t.sub,
    border: `1px solid ${t.border}`, cursor: "pointer", whiteSpace: "nowrap",
  });
  neverBtn.title = currentChannelInfo
    ? `Never show AI summaries for ${currentChannelInfo.name}`
    : "Never show AI summaries for this channel";
  neverBtn.addEventListener("mouseenter", () => { neverBtn.style.borderColor = "#dc2626"; neverBtn.style.color = "#dc2626"; });
  neverBtn.addEventListener("mouseleave", () => { neverBtn.style.borderColor = t.border; neverBtn.style.color = t.sub; });
  neverBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentChannelInfo) {
      void addBlockedChannelEntry(currentChannelInfo).then(() => {
        removeSummaryPanel();
        log("channel blocked from summary:", currentChannelInfo!.name);
      });
    }
  });

  actionRow.append(summaryBtn, neverBtn);
  panel.append(head, actionRow);

  summaryPanel = panel;
  host.prepend(panel);
  log("idle panel shown");
}

// --- comments panel (injected into ytd-comments-header-renderer) ----------

function showCommentsSentimentResult(sentiment: string, audienceScore?: number): void {
  const host = commentsHeaderHost();
  removeCommentsPanel();
  if (!host) return;

  const t = theme();
  const panel = document.createElement("div");
  panel.id = TLDW_COMMENTS_PANEL_ID;
  Object.assign(panel.style, {
    display: "flex", alignItems: "flex-start", flexDirection: "column", gap: "4px",
    padding: "10px 0 12px",
    font: "13px/1.5 Roboto, system-ui, sans-serif",
    borderBottom: `1px solid ${t.border}`,
    marginBottom: "4px",
  });

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" });

  const label = document.createElement("span");
  label.textContent = "💬 Comment Analysis";
  Object.assign(label.style, { fontWeight: "700", fontSize: "12px", color: t.sub });

  if (audienceScore !== undefined) {
    const scorePill = document.createElement("span");
    scorePill.textContent = `${audienceScore}/10`;
    Object.assign(scorePill.style, {
      fontSize: "11px", fontWeight: "700", padding: "2px 8px",
      borderRadius: "999px", background: t.border, color: t.text, whiteSpace: "nowrap",
    });
    row.append(label, scorePill);
  } else {
    row.append(label);
  }

  const text = document.createElement("div");
  text.textContent = sentiment;
  Object.assign(text.style, { fontSize: "13px", color: t.text, lineHeight: "1.5" });

  panel.append(row, text);
  host.prepend(panel);
  commentsPanel = panel;
  pendingCommentSentiment = null;
  log("comment sentiment shown in comments panel");
}

/** Fill the comments panel with sentiment. Falls back to storing pending if comments section not yet in DOM. */
function fillCommunitySection(sentiment: string, audienceScore?: number): void {
  if (commentsHeaderHost()) {
    showCommentsSentimentResult(sentiment, audienceScore);
  } else {
    pendingCommentSentiment = { sentiment, audienceScore };
    log("comment sentiment stored as pending — comments section not yet in DOM");
  }
}

function showCommentsIdlePanel(onGetComments: () => void): void {
  const host = commentsHeaderHost();
  if (!host) return;
  removeCommentsPanel();

  const t = theme();
  const panel = document.createElement("div");
  panel.id = TLDW_COMMENTS_PANEL_ID;
  Object.assign(panel.style, {
    display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
    padding: "10px 0 12px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
    borderBottom: `1px solid ${t.border}`,
    marginBottom: "4px",
  });

  const getBtn = document.createElement("button");
  getBtn.textContent = "Get Comment Analysis";
  Object.assign(getBtn.style, {
    fontSize: "13px", fontWeight: "600", padding: "7px 18px", borderRadius: "999px",
    background: "#0d9488", color: "#fff", border: "none", cursor: "pointer", whiteSpace: "nowrap",
  });
  getBtn.title = "Analyze viewer comments for this video";
  getBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    getBtn.textContent = "Analyzing…";
    getBtn.disabled = true;
    onGetComments();
  });

  // Auto-run toggle for comments
  const autoToggle = currentChannelInfo
    ? buildAutoToggle(currentChannelInfo, "comments", currentAutoRunComments, t)
    : null;

  const neverBtn = document.createElement("button");
  neverBtn.textContent = "Never";
  Object.assign(neverBtn.style, {
    fontSize: "12px", fontWeight: "600", padding: "7px 14px", borderRadius: "999px",
    background: "transparent", color: t.sub, border: `1px solid ${t.border}`,
    cursor: "pointer", whiteSpace: "nowrap",
  });
  neverBtn.title = currentChannelInfo
    ? `Never show comment analysis for ${currentChannelInfo.name}`
    : "Never show comment analysis for this channel";
  neverBtn.addEventListener("mouseenter", () => { neverBtn.style.borderColor = "#dc2626"; neverBtn.style.color = "#dc2626"; });
  neverBtn.addEventListener("mouseleave", () => { neverBtn.style.borderColor = t.border; neverBtn.style.color = t.sub; });
  neverBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentChannelInfo) {
      void addBlockedCommentsChannelEntry(currentChannelInfo).then(() => {
        removeCommentsPanel();
        log("channel blocked from comment analysis:", currentChannelInfo!.name);
      });
    }
  });

  panel.append(getBtn, ...(autoToggle ? [autoToggle] : []), neverBtn);
  host.prepend(panel);
  commentsPanel = panel;
  log("comments idle panel shown");
}

async function maybeStartCommentsInjection(): Promise<void> {
  const r = await chrome.storage.local.get(["settings", AUTO_RUN_CHANNELS_KEY, BLOCKED_COMMENTS_KEY]);
  const s = r["settings"] as Record<string, unknown> | undefined;
  if (!(s?.useDirectApi as boolean) || !(s?.geminiApiKey as string)) return;

  // If we have a pending cached sentiment, show it immediately.
  if (pendingCommentSentiment) {
    showCommentsSentimentResult(pendingCommentSentiment.sentiment, pendingCommentSentiment.audienceScore);
    return;
  }

  // Check if comments are blocked for this channel.
  if (currentChannelInfo) {
    const blocked = (r[BLOCKED_COMMENTS_KEY] as BlockedChannelEntry[]) ?? [];
    if (blocked.some((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)) {
      log("comment analysis blocked for channel:", currentChannelInfo.name);
      return;
    }
  }

  const autoRunChannels = (r[AUTO_RUN_CHANNELS_KEY] as AutoRunChannelEntry[]) ?? [];
  const channelEntry = currentChannelInfo
    ? autoRunChannels.find((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)
    : undefined;
  const shouldAutoRun = channelEntry?.autoRunComments ?? false;
  currentAutoRunComments = shouldAutoRun;

  const fireComments = () => {
    try { void chrome.runtime.sendMessage({ type: "ASK_COMMENTS" }); } catch { /* best effort */ }
  };

  if (shouldAutoRun) {
    // Show a loading shimmer in the comments panel and kick off the call.
    const host = commentsHeaderHost();
    if (host) {
      removeCommentsPanel();
      const t = theme();
      ensureShimmerStyle();
      const panel = document.createElement("div");
      panel.id = TLDW_COMMENTS_PANEL_ID;
      Object.assign(panel.style, {
        padding: "10px 0 12px", fontSize: "13px", color: t.sub,
        animation: "tldw-shimmer 1.4s infinite",
        borderBottom: `1px solid ${t.border}`, marginBottom: "4px",
        font: "13px/1.4 Roboto, system-ui, sans-serif",
      });
      panel.textContent = "💬 Analyzing comments…";
      host.prepend(panel);
      commentsPanel = panel;
    }
    fireComments();
  } else {
    showCommentsIdlePanel(fireComments);
  }
}

function watchForCommentsSection(): void {
  if (commentsObserver) { commentsObserver.disconnect(); commentsObserver = null; }
  if (commentsHeaderHost()) {
    void maybeStartCommentsInjection();
    return;
  }
  commentsObserver = new MutationObserver(() => {
    if (commentsHeaderHost()) {
      commentsObserver?.disconnect();
      commentsObserver = null;
      void maybeStartCommentsInjection();
    }
  });
  commentsObserver.observe(document.body, { childList: true, subtree: true });
}

// --- auto TL;DW ----------------------------------------------------------

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const autoRunVideoIds = new Set<string>();

/**
 * Direct API path: fires on navigation.
 * - Reads the channel auto-run list and cache from storage.
 * - If there's a cached result: show it immediately.
 * - If the channel is on the auto-run list: show the loading skeleton and fire
 *   the Gemini API call automatically.
 * - Otherwise: show an idle panel with a "Get Summary" button and a per-channel
 *   auto-run toggle so the user can opt in for future visits.
 */
async function maybeStartDirectApiRun(): Promise<void> {
  const vid = currentVideoId();
  if (!vid) return;

  // Set currentChannelInfo early so comments injection can use it even when we return early.
  currentChannelInfo = getChannelInfo();

  const r = await chrome.storage.local.get(["settings", "tldwSummaryCache", AUTO_RUN_CHANNELS_KEY, BLOCKED_CHANNELS_KEY]);
  const s = r["settings"] as Record<string, unknown> | undefined;
  if (!(s?.useDirectApi as boolean) || !(s?.geminiApiKey as string)) return;

  // If the user has blocked this channel from summary, skip injection entirely.
  if (currentChannelInfo) {
    const blocked = (r[BLOCKED_CHANNELS_KEY] as BlockedChannelEntry[]) ?? [];
    if (blocked.some((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)) {
      log("channel blocked from summary, skipping panel injection:", currentChannelInfo.name);
      return;
    }
  }

  const autoRunChannels = await readAutoRunChannels();
  const channelEntry = currentChannelInfo
    ? autoRunChannels.find((c) => c.id === currentChannelInfo!.id || c.name === currentChannelInfo!.name)
    : undefined;

  currentAutoRunSummary = channelEntry?.autoRunSummary ?? false;

  // Helper: show loading skeleton and fire the summary API call.
  const startApiCall = async () => {
    showLoadingPanel();
    void getTranscript();
    log("direct API call started");
    try {
      await chrome.runtime.sendMessage({ type: "ASK" });
    } catch { /* best effort */ }
  };

  // Fast path: cached result — show immediately, skip API call.
  type CacheEntry = { tldw: TldwSummary; cachedAt: string; commentSentiment?: string; audienceScore?: number; userRating?: "watch" | "skim" | "skip" };
  const cache = r["tldwSummaryCache"] as Record<string, CacheEntry> | undefined;
  const cached = cache?.[vid];
  if (cached && Date.now() - new Date(cached.cachedAt).getTime() < CACHE_TTL_MS) {
    showSummaryPanel({ ...cached.tldw, source: "cached" }, undefined, cached.userRating, vid);
    // Store cached comment sentiment so the comments panel can show it when it appears.
    if (cached.commentSentiment) {
      pendingCommentSentiment = { sentiment: cached.commentSentiment, audienceScore: cached.audienceScore };
    }
    log("served from cache");
    return;
  }

  // Auto-run summary: fire immediately.
  if (currentAutoRunSummary) {
    await startApiCall();
    return;
  }

  // Show idle panel with manual "Get Summary" + "Never" buttons.
  showIdlePanel(() => { void startApiCall(); });
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

// yt-navigate-finish doesn't fire for all YouTube SPA navigation types.
// Three-layer strategy: immediate (page load / refresh), event-based (when
// YouTube fires its own event), and 500ms polling (everything else).
let lastHandledUrl = "";

function onNavigate(): void {
  // Ignore hash-only changes; video IDs are always in pathname+search.
  const url = location.pathname + location.search;
  if (url === lastHandledUrl) return;
  lastHandledUrl = url;
  removeSummaryPanel();
  removeCommentsPanel();
  if (commentsObserver) { commentsObserver.disconnect(); commentsObserver = null; }
  pendingCommentSentiment = null;
  activeTranscriptFetch = null;
  currentChannelInfo = null;
  currentAutoRunSummary = false;
  currentAutoRunComments = false;
  void maybeStartDirectApiRun().then(() => { watchForCommentsSection(); });
  setTimeout(() => { void autoRunIfLong(); }, 2500);
}

// On page refresh / initial load, delay 1 s so YouTube's Polymer components
// finish their initial render before we inject. Firing immediately (at
// document_idle) means YouTube's own DOM update wipes the panel out before
// the user sees it. yt-navigate-finish and the 500ms interval handle
// subsequent SPA navigations without any delay.
setTimeout(onNavigate, 1000);
window.addEventListener("yt-navigate-finish", onNavigate);
setInterval(onNavigate, 500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === "GET_TRANSCRIPT") {
    log("transcript requested");
    void getTranscript().then((transcript) => sendResponse({ transcript }));
    return true;
  }
  if (type === "GET_COMMENTS") {
    log("comments requested");
    void getTopComments().then((comments) => sendResponse({ comments }));
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
    const msg = message as { tldw?: TldwSummary; source?: string; channelStats?: ChannelComparison };
    const tldw = msg?.tldw;
    if (tldw?.verdict && tldw.summary) {
      showSummaryPanel({ ...tldw, source: msg.source }, msg.channelStats, undefined, currentVideoId());
    }
    sendResponse({ ok: true });
    return false;
  }
  if (type === "SET_COMMENT_SENTIMENT") {
    const msg = message as { sentiment?: string; audienceScore?: number };
    if (msg.sentiment) {
      fillCommunitySection(msg.sentiment, msg.audienceScore);
    } else {
      // No sentiment (comments unavailable or error) — just remove loading shimmer.
      removeCommentsPanel();
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

export {};
