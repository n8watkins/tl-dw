/**
 * SponsorBlock auto-skip. On every YouTube watch-page navigation it asks the
 * background worker for this video's sponsor segments (the free, key-less
 * SponsorBlock community API), then watches the player and seeks past each
 * sponsored segment as playback reaches it. A toast offers one-click undo.
 *
 * Design notes (see LESSONS_LEARNED.md):
 *  - Runs as its own content script so the skip engine is independent of the
 *    summary widget in youtube.ts.
 *  - The fetch happens in the worker so host_permissions bypass CORS.
 *  - Each segment is skipped at most once per load, and only when entered via
 *    normal playback — so manually scrubbing into a sponsor (or undoing a skip)
 *    is never fought.
 */

import type { SponsorSegment, SponsorSegmentsResponse } from "../types";

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

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

let toastEl: HTMLElement | null = null;
let toastTimer: number | undefined;

// Publish the current sponsor-segment count to the TL;DW panel (rendered by
// youtube.ts, which shares this page's content-script world). The panel shows a
// "⏭ N" pill inside its own injection rather than a separate floating box.
function publishCount(count: number): void {
  (window as { __tldwSponsorCount?: number }).__tldwSponsorCount = count;
  window.dispatchEvent(new CustomEvent("tldw-sponsor-update"));
}

function showSkipToast(seg: SponsorSegment): void {
  toastEl?.remove();
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "left:16px",
    "bottom:84px",
    "z-index:2147483647",
    "background:rgba(20,20,20,0.94)",
    "color:#fff",
    "font:13px/1.3 Roboto,system-ui,sans-serif",
    "padding:10px 12px",
    "border-radius:10px",
    "box-shadow:0 6px 24px rgba(0,0,0,0.4)",
    "display:flex",
    "align-items:center",
    "gap:10px",
  ].join(";");

  const label = document.createElement("span");
  label.textContent = `⏭ Skipped sponsor (${fmt(seg.end - seg.start)})`;

  const undo = document.createElement("button");
  undo.textContent = "Undo";
  undo.style.cssText =
    "background:transparent;border:1px solid #555;color:#8ab4f8;border-radius:6px;padding:3px 10px;cursor:pointer;font-weight:700;";
  undo.addEventListener("click", () => {
    disabled.add(seg); // don't re-skip after the user pulls it back
    if (video) {
      programmaticSeek = true;
      video.currentTime = Math.max(0, seg.start - 0.5);
    }
    el.remove();
    toastEl = null;
  });

  el.append(label, undo);
  document.body.appendChild(el);
  toastEl = el;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.remove();
    if (toastEl === el) toastEl = null;
  }, 6000);
}

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
      showSkipToast(seg);
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
  for (const seg of segments) {
    if (t >= seg.start && t < seg.end) disabled.add(seg);
  }
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
  toastEl?.remove();
  toastEl = null;
  publishCount(0);

  enabled = await loadEnabled();
  if (!enabled) return;

  const fetched = await fetchSegments(vid);
  // Guard against a navigation that happened during the async fetch.
  if (currentVid !== vid) return;
  segments = fetched;
  log(`${segments.length} sponsor segment(s) for ${vid}`);
  if (segments.length > 0) {
    attach();
    publishCount(segments.length);
  }
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
  // Reflect the toggle in the panel pill: hide the count when off, restore it on.
  publishCount(enabled ? segments.length : 0);
});

export {};
