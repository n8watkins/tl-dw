/**
 * Watch-time engine for automatic engagement tracking.
 *
 * Tracks how many content-seconds the user has actually watched for each video
 * and periodically reports the delta to the background worker via WATCH_PROGRESS.
 * The background accumulates the total and auto-rates videos as
 * Engaged / Skimmed / Skipped based on configurable percentage thresholds.
 *
 * Design mirrors sponsorblock.ts:
 *  - Same video-element attach pattern with setTimeout retry.
 *  - Same three-layer SPA-nav strategy (immediate + yt-navigate-finish + interval).
 *  - Deduplication by videoId from URL.
 *  - Live reaction to storage.onChanged for the trackEngagement toggle.
 *
 * Time tracking:
 *  - Uses `timeupdate` events; delta = currentTime − lastTime.
 *  - Only counts deltas in (0, 2.5] to filter seeks and pauses.
 *    Works at 2x speed: at 2x, timeupdate fires ~4× per second, so deltas are
 *    ≤0.5s of wall-clock ≈ up to 1s of content — well within the 2.5s cap.
 *  - Fires in background tabs because timeupdate fires for audible media.
 *  - On `seeked`, resets lastTime so the seek gap is not counted.
 *
 * Reporting triggers:
 *  - Every 10 accumulated unreported content-seconds.
 *  - On `visibilitychange` (hidden).
 *  - On navigation away (handleNav reset).
 *  - On `pagehide`.
 *
 * Window bridge:
 *  - `window.__tldwWatch.getState()` returns { videoId, watchedSeconds, durationSeconds, verdict }.
 *  - Fires `new CustomEvent("tldw-watch-update")` on document when accumulated
 *    seconds change by ≥1s, so the on-page cue in youtube.ts can update live.
 */

import { computeEngagementVerdict } from "../lib/engagement";
import type { EngagementVerdict } from "../lib/engagement";

const log = (...args: unknown[]) => console.log("[TL;DW WT]", ...args);

// ---- module state -----------------------------------------------------------

let currentVid = "";
let lastHandledVid = "";

/** Accumulated content-seconds for the current video (never resets mid-video). */
let totalWatched = 0;
/** Unreported content-seconds since the last successful sendMessage. */
let pendingDelta = 0;
/** Threshold for periodic reports (content-seconds). */
const REPORT_INTERVAL_S = 10;

let video: HTMLVideoElement | null = null;
let lastTime = 0;
/** Last totalWatched value at which we fired a tldw-watch-update event. */
let lastNotifiedAt = 0;

let trackEngagement = true;

/** Cached settings thresholds used for the live verdict calculation. */
let engagedPct = 60;
let skimmedPct = 15;
let showEngagementStatus = true;

// ---- window bridge ----------------------------------------------------------

export type WatchWindowState = {
  videoId: string;
  watchedSeconds: number;
  durationSeconds: number;
  verdict: EngagementVerdict;
};

function currentDuration(): number {
  return (video && Number.isFinite(video.duration) && video.duration > 0)
    ? video.duration
    : 0;
}

function currentSawSummary(): boolean {
  return !!document.getElementById("tldw-summary");
}

function currentVerdict(): EngagementVerdict {
  const dur = currentDuration();
  if (!dur) return null;
  return computeEngagementVerdict(totalWatched, dur, {
    engagedPct,
    skimmedPct,
    sawSummary: currentSawSummary(),
  });
}

function getState(): WatchWindowState {
  return {
    videoId: currentVid,
    watchedSeconds: totalWatched,
    durationSeconds: currentDuration(),
    verdict: currentVerdict(),
  };
}

(window as unknown as { __tldwWatch?: { getState: () => WatchWindowState } }).__tldwWatch = {
  getState,
};

function notifyPanel(): void {
  if (!showEngagementStatus) return;
  if (totalWatched - lastNotifiedAt >= 1) {
    lastNotifiedAt = totalWatched;
    document.dispatchEvent(new CustomEvent("tldw-watch-update"));
  }
}

// ---- reporting --------------------------------------------------------------

function videoIdFromUrl(): string {
  try {
    return new URLSearchParams(location.search).get("v") ?? "";
  } catch {
    return "";
  }
}

function currentVideoMeta(): { url: string; title?: string; channel?: string; avatarUrl?: string } {
  const title = document.title.replace(/\s*-\s*YouTube$/, "").trim() || undefined;
  const channel =
    document
      .querySelector(
        "ytd-channel-name a, #owner #channel-name a, ytd-video-owner-renderer a.yt-simple-endpoint",
      )
      ?.textContent?.trim() || undefined;
  const avatarUrl =
    document.querySelector<HTMLImageElement>(
      "ytd-video-owner-renderer #avatar img, #owner yt-img-shadow img, ytd-video-owner-renderer yt-img-shadow img",
    )?.src || undefined;
  return {
    url: location.href,
    title,
    channel,
    avatarUrl,
  };
}

async function reportProgress(forced = false): Promise<void> {
  if (!trackEngagement) return;
  if (pendingDelta <= 0 && !forced) return;
  const vid = currentVid;
  if (!vid) return;

  const delta = pendingDelta;
  const dur = currentDuration();
  const sawSummary = currentSawSummary();
  const videoMeta = currentVideoMeta();

  try {
    await chrome.runtime.sendMessage({
      type: "WATCH_PROGRESS",
      videoId: vid,
      deltaSeconds: delta,
      durationSeconds: dur,
      sawSummary,
      video: videoMeta,
    });
    // Only zero out pendingDelta after the message successfully resolves.
    if (currentVid === vid) pendingDelta = 0;
  } catch {
    // Service worker may be sleeping — keep pendingDelta for the next report.
  }
}

// ---- video element listener -------------------------------------------------

function onTimeUpdate(): void {
  if (!trackEngagement || !video) return;
  const t = video.currentTime;
  const delta = t - lastTime;
  lastTime = t;
  // Only count forward motion within a reasonable range (filters seeks / stalls).
  if (delta > 0 && delta <= 2.5) {
    totalWatched += delta;
    pendingDelta += delta;
    notifyPanel();
    if (pendingDelta >= REPORT_INTERVAL_S) {
      void reportProgress();
    }
  }
}

function onSeeked(): void {
  // Reset so the next timeupdate doesn't count the seek gap as watch time.
  if (video) lastTime = video.currentTime;
}

function findVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
}

function attach(): void {
  const v = findVideo();
  if (!v) {
    window.setTimeout(attach, 500);
    return;
  }
  if (v === video) return; // already wired
  video?.removeEventListener("timeupdate", onTimeUpdate);
  video?.removeEventListener("seeked", onSeeked);
  video = v;
  lastTime = v.currentTime;
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("seeked", onSeeked);
}

// ---- navigation -------------------------------------------------------------

async function loadSettings(): Promise<void> {
  const r = await chrome.storage.local.get("settings");
  const s = r["settings"] as {
    trackEngagement?: boolean;
    engagedPct?: number;
    skimmedPct?: number;
    showEngagementStatus?: boolean;
  } | undefined;
  trackEngagement = s?.trackEngagement !== false;
  engagedPct = s?.engagedPct ?? 60;
  skimmedPct = s?.skimmedPct ?? 15;
  showEngagementStatus = s?.showEngagementStatus !== false;
}

async function handleNav(): Promise<void> {
  const vid = videoIdFromUrl();
  if (!vid || vid === lastHandledVid) return;

  // Report any pending delta for the OLD video before resetting.
  if (lastHandledVid && pendingDelta > 0) {
    void reportProgress(true);
  }

  lastHandledVid = vid;
  currentVid = vid;
  totalWatched = 0;
  pendingDelta = 0;
  lastNotifiedAt = 0;
  lastTime = 0;

  await loadSettings();
  if (!trackEngagement) return;

  attach();
  log("tracking video", vid);
}

// ---- visibility / pagehide flush ------------------------------------------

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void reportProgress(true);
  }
});

window.addEventListener("pagehide", () => {
  void reportProgress(true);
});

// ---- settings hot-swap ------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes["settings"]) return;
  const next = changes["settings"].newValue as {
    trackEngagement?: boolean;
    engagedPct?: number;
    skimmedPct?: number;
    showEngagementStatus?: boolean;
  } | undefined;
  const wasTracking = trackEngagement;
  trackEngagement = next?.trackEngagement !== false;
  engagedPct = next?.engagedPct ?? 60;
  skimmedPct = next?.skimmedPct ?? 15;
  showEngagementStatus = next?.showEngagementStatus !== false;

  if (!trackEngagement && wasTracking && pendingDelta > 0) {
    // Flush on disable so we don't lose data already accumulated.
    void reportProgress(true);
  }
  // Notify panel in case showEngagementStatus changed.
  document.dispatchEvent(new CustomEvent("tldw-watch-update"));
});

// ---- three-layer SPA strategy (mirrors sponsorblock.ts) --------------------

void handleNav();
window.addEventListener("yt-navigate-finish", () => void handleNav());
window.setInterval(() => void handleNav(), 1000);

export {};
