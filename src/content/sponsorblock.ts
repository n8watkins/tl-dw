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

// Seconds of playback after an auto-skip during which the panel offers Undo;
// once you've watched this far past the segment, "the ad is gone" and Undo hides.
const UNDO_GRACE = 6;

let currentVid = "";
let enabled = true;
let segments: SponsorSegment[] = [];
const skipped = new Set<SponsorSegment>(); // already auto-skipped this load
const disabled = new Set<SponsorSegment>(); // user scrubbed in / undid — leave alone
const undoableUntil = new Map<SponsorSegment, number>(); // seg -> video time the Undo expires
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
    undoable: undoableUntil.has(s),
  }));
}

function notifyPanel(): void {
  window.dispatchEvent(new CustomEvent("tldw-sponsor-update"));
}

/** Seek to a segment's start/end and take manual control (don't auto-skip it
 *  again). Drives the clickable timestamps and the Undo button in the panel. */
function jumpTo(index: number, edge: "start" | "end"): void {
  const seg = segments[index];
  if (!seg || !video) return;
  disabled.add(seg);
  skipped.delete(seg);
  undoableUntil.delete(seg);
  programmaticSeek = true;
  video.currentTime = edge === "end" ? seg.end : Math.max(0, seg.start);
  notifyPanel();
}

(window as unknown as { __tldwSponsor?: SponsorWindowApi }).__tldwSponsor = {
  getSegments: () => (enabled ? segmentState() : []),
  isEnabled: () => enabled,
  jumpTo,
};

function onTimeUpdate(): void {
  if (!enabled || !video || segments.length === 0) return;
  const t = video.currentTime;

  // Retire Undo windows we've now played past ("the ad is gone").
  if (undoableUntil.size > 0) {
    let expired = false;
    for (const [seg, until] of undoableUntil) {
      if (t >= until) { undoableUntil.delete(seg); expired = true; }
    }
    if (expired) notifyPanel();
  }

  for (const seg of segments) {
    // Skip every time we play into it — even on a rewatch — UNLESS the user has
    // taken manual control of it (clicked a timestamp / Undo / scrubbed in).
    if (disabled.has(seg)) continue;
    // Only skip when we cross into the segment via normal playback (we were
    // before it a tick ago) — not when the user scrubbed into its middle.
    if (t >= seg.start && t < seg.end - 0.4 && lastTime < seg.end) {
      skipped.add(seg);
      undoableUntil.set(seg, seg.end + UNDO_GRACE); // Undo available briefly
      programmaticSeek = true;
      video.currentTime = seg.end;
      notifyPanel();
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
      undoableUntil.delete(seg);
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
  undoableUntil.clear();
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
