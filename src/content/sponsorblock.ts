/**
 * SponsorBlock auto-skip. On every YouTube watch-page navigation it asks the
 * background worker for this video's sponsor segments (the free, key-less
 * SponsorBlock community API), then watches the player and seeks past each
 * sponsored segment as playback reaches it. The TL;DW panel (youtube.ts) shows
 * the segment timestamps and a per-segment Undo, fed by the window bridge below.
 *
 * Design notes (see LESSONS_LEARNED.md):
 *  - Runs as its own content script so the skip engine is independent of the
 *    summary widget in youtube.ts.
 *  - The fetch happens in the worker so host_permissions bypass CORS.
 *  - Each segment is skipped at most once per load, and only when entered via
 *    normal playback — so manually scrubbing into a sponsor (or undoing a skip)
 *    is never fought.
 */

import type {
  SponsorSegment,
  SponsorSegmentsResponse,
  SponsorPanelSegment,
  SponsorWindowApi,
} from "../types";

const log = (...args: unknown[]) => console.log("[TL;DW SB]", ...args);

let currentVid = "";
let enabled = true;
let segments: SponsorSegment[] = [];
const skipped = new Set<SponsorSegment>(); // already auto-skipped this load
const disabled = new Set<SponsorSegment>(); // user scrubbed in / undid — leave alone
let video: HTMLVideoElement | null = null;
let lastTime = 0;
let programmaticSeek = false;

function videoIdFromUrl(): string {
  try {
    return new URLSearchParams(location.search).get("v") ?? "";
  } catch {
    return "";
  }
}

async function loadEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as { skipSponsors?: boolean } | undefined;
  return s?.skipSponsors !== false; // default on
}

async function fetchSegments(videoId: string): Promise<SponsorSegment[]> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "GET_SPONSOR_SEGMENTS",
      videoId,
    })) as SponsorSegmentsResponse | undefined;
    return res?.segments ?? [];
  } catch {
    return []; // worker asleep / no segments — best effort
  }
}

function findVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
}

// --- bridge to the TL;DW panel (youtube.ts) -------------------------------
// Same content-script world, so we expose a small API on window and fire a
// `tldw-sponsor-update` event on every change. The panel renders the segment
// timestamps and the Undo control inside its own injection (no floating box).

function segmentState(): SponsorPanelSegment[] {
  return segments.map((s, i) => ({
    index: i,
    start: s.start,
    end: s.end,
    category: s.category,
    skipped: skipped.has(s),
    disabled: disabled.has(s),
  }));
}

function notifyPanel(): void {
  window.dispatchEvent(new CustomEvent("tldw-sponsor-update"));
}

/** Jump to a segment's start and keep it (don't auto-skip) — drives the
 *  clickable timestamp and the Undo button in the panel. */
function jumpTo(index: number): void {
  const seg = segments[index];
  if (!seg || !video) return;
  disabled.add(seg);
  skipped.delete(seg);
  programmaticSeek = true;
  video.currentTime = Math.max(0, seg.start - 0.3);
  notifyPanel();
}

/** Skip a segment now (seek to its end) — drives the panel's Skip button. */
function skipNow(index: number): void {
  const seg = segments[index];
  if (!seg || !video) return;
  skipped.add(seg);
  disabled.delete(seg);
  programmaticSeek = true;
  video.currentTime = seg.end;
  notifyPanel();
}

(window as unknown as { __tldwSponsor?: SponsorWindowApi }).__tldwSponsor = {
  getSegments: () => (enabled ? segmentState() : []),
  isEnabled: () => enabled,
  jumpTo,
  skipNow,
};

function onTimeUpdate(): void {
  if (!enabled || !video || segments.length === 0) return;
  const t = video.currentTime;
  for (const seg of segments) {
    if (skipped.has(seg) || disabled.has(seg)) continue;
    // Only skip when we cross into the segment via normal playback (we were
    // before it a tick ago) — not when the user scrubbed into its middle.
    if (t >= seg.start && t < seg.end - 0.4 && lastTime < seg.end) {
      skipped.add(seg);
      programmaticSeek = true;
      video.currentTime = seg.end;
      notifyPanel(); // panel now shows this segment as skipped, with an Undo
      break;
    }
  }
  lastTime = t;
}

function onSeeked(): void {
  // Our own seeks set programmaticSeek; a user seek that lands inside a segment
  // means they want to watch it, so disable that one.
  if (programmaticSeek) {
    programmaticSeek = false;
    return;
  }
  if (!video) return;
  const t = video.currentTime;
  let changed = false;
  for (const seg of segments) {
    if (t >= seg.start && t < seg.end && !disabled.has(seg)) {
      disabled.add(seg);
      changed = true;
    }
  }
  if (changed) notifyPanel();
}

function attach(): void {
  const v = findVideo();
  if (!v) {
    window.setTimeout(attach, 500); // player not ready yet
    return;
  }
  if (v === video) return; // already wired (YouTube reuses the element across SPA nav)
  video?.removeEventListener("timeupdate", onTimeUpdate);
  video?.removeEventListener("seeked", onSeeked);
  video = v;
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("seeked", onSeeked);
}

let lastHandledVid = "";
async function handleNav(): Promise<void> {
  const vid = videoIdFromUrl();
  if (!vid || vid === lastHandledVid) return;
  lastHandledVid = vid;
  currentVid = vid;
  segments = [];
  skipped.clear();
  disabled.clear();
  lastTime = 0;
  notifyPanel();

  enabled = await loadEnabled();
  if (!enabled) { notifyPanel(); return; }

  const fetched = await fetchSegments(vid);
  // Guard against a navigation that happened during the async fetch.
  if (currentVid !== vid) return;
  segments = fetched;
  log(`${segments.length} sponsor segment(s) for ${vid}`);
  if (segments.length > 0) attach();
  notifyPanel();
}

// Same three-layer SPA strategy youtube.ts uses: initial load + YouTube's own
// event + a low-frequency poll for navigations that fire neither.
void handleNav();
window.addEventListener("yt-navigate-finish", () => void handleNav());
window.setInterval(() => void handleNav(), 1000);

// React live to the toggle so turning it off stops skipping without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes["settings"]) return;
  const next = changes["settings"].newValue as { skipSponsors?: boolean } | undefined;
  enabled = next?.skipSponsors !== false;
  notifyPanel(); // reflect the toggle in the panel (segments hidden when off)
});

export {};
