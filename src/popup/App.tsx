import { useEffect, useState } from "react";
import type {
  DeliveryStatus,
  OpenSearch,
  PromptProfile,
  SearchHistoryEntry,
  Settings,
} from "../types";
import {
  DESTINATIONS,
  destinationVerb,
  getDestination,
  isYouTubeVideoUrl,
} from "../lib/constants";
import {
  addOpenSearch,
  clearDeliveryStatuses,
  getDeliveryStatuses,
  getHistory,
  getOpenSearches,
  getProfiles,
  getSettings,
  setPendingPrompt,
} from "../lib/storage";

/* Inline icons — stroke uses currentColor so they inherit each button's color. */
const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SparkIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
      <path d="M19 14l.7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

function MomentsIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function cleanTitle(raw?: string): string {
  if (!raw) return "Current YouTube video";
  return raw
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*-\s*YouTube\s*$/, "")
    .trim();
}

const VERSION = chrome.runtime.getManifest().version;
const ICON_URL = chrome.runtime.getURL("icons/tl-dw-32.png");

export function App() {
  const [profiles, setProfiles] = useState<PromptProfile[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [destinationId, setDestinationId] = useState("gemini");
  const [curiosity, setCuriosity] = useState("");
  const [gate, setGate] = useState(false);
  const [openSearches, setOpenSearches] = useState<OpenSearch[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [statuses, setStatuses] = useState<DeliveryStatus[]>([]);

  useEffect(() => {
    void (async () => {
      const [p, s, tabs, open, hist, stat] = await Promise.all([
        getProfiles(),
        getSettings(),
        chrome.tabs.query({ active: true, currentWindow: true }),
        getOpenSearches(),
        getHistory(),
        getDeliveryStatuses(),
      ]);
      setProfiles(p);
      setSettings(s);
      setTab(tabs[0] ?? null);
      setSelectedId(s.defaultProfileId ?? p[0]?.id ?? "");
      setDestinationId(s.destinationId ?? "gemini");
      setGate(s.worthWatchingGate ?? false);
      setOpenSearches(open);
      setHistory(hist);
      setStatuses(stat);
      setReady(true);
    })();
  }, []);

  // Collapse to the most recent status per (kind, site) — statuses are stored
  // newest-first — so a later success hides an earlier failure instead of the
  // red alert sticking around after the next send works.
  const latest = new Map<string, DeliveryStatus>();
  for (const s of statuses) {
    const key = `${s.kind ?? "delivery"}:${s.site}`;
    if (!latest.has(key)) latest.set(key, s);
  }
  const current = [...latest.values()];
  const failures = current.filter((s) => (s.kind ?? "delivery") === "delivery" && !s.ok);
  const gateSkips = current.filter((s) => s.kind === "gate" && !s.ok);

  async function dismissFailures() {
    await clearDeliveryStatuses();
    setStatuses([]);
  }

  const onVideo = isYouTubeVideoUrl(tab?.url);
  // If the current tab is a destination tab TL;DW opened, link it back to source.
  const linkedSearch = openSearches.find((s) => s.tabId === tab?.id);

  // Per-session override only: changing the destination here does NOT touch the
  // saved default (set in Settings). Reopening the popup reverts to the default.
  function changeDestination(id: string) {
    setDestinationId(id);
    setCopyStatus("");
  }

  function send() {
    const dest = getDestination(destinationId);
    // Hand off to the background worker's auto-fill flow, passing the session
    // destination so it routes here even if the saved default differs. Fire
    // and forget, then close: the worker runs independently of the popup, so
    // we don't block the window open while it scrapes the transcript (which
    // can take several seconds for non-Gemini destinations).
    void chrome.runtime.sendMessage({
      type: "ASK",
      profileId: selectedId,
      destinationId: dest.id,
      worthWatchingGate: gate,
      userCuriosity: curiosity.trim() || undefined,
    });
    window.close();
  }

  /**
   * Toggle the on-page "key moments" panel. When called from a destination tab
   * (pass the linked OpenSearch), it focuses the source YouTube tab first; if
   * that tab has closed it reopens the video URL and exits. When called from the
   * YouTube tab itself (no argument), it targets the current tab as before.
   */
  async function showMoments(search?: OpenSearch) {
    setBusy(true);
    setCopyStatus("Finding key moments…");

    let targetTabId: number | undefined;

    if (search?.sourceTabId !== undefined) {
      try {
        const t = await chrome.tabs.get(search.sourceTabId);
        await chrome.tabs.update(search.sourceTabId, { active: true });
        if (t.windowId !== undefined) {
          await chrome.windows.update(t.windowId, { focused: true });
        }
        targetTabId = search.sourceTabId;
      } catch {
        // Source tab is gone — reopen the video as a fallback.
        if (search.videoUrl) {
          await chrome.tabs.create({ url: search.videoUrl, active: true });
          window.close();
          return;
        }
        setCopyStatus("Couldn't reach the YouTube tab — it may have been closed.");
        setBusy(false);
        return;
      }
    } else {
      targetTabId = tab?.id;
    }

    if (!targetTabId) {
      setBusy(false);
      return;
    }

    try {
      const r = (await chrome.tabs.sendMessage(targetTabId, {
        type: "TOGGLE_MOMENTS",
      })) as { ok: boolean; shown?: boolean; reason?: string } | undefined;
      if (r?.ok) {
        // Showing the panel: close the popup so it's visible. Hiding it: keep
        // the popup open and say so, rather than silently closing.
        if (r.shown) {
          window.close();
        } else {
          setCopyStatus("Hid key moments.");
        }
        return;
      }
      setCopyStatus(
        r?.reason === "no transcript"
          ? "No transcript found (does this video have captions?)."
          : "Couldn't show key moments — reload the YouTube tab and retry.",
      );
    } catch {
      setCopyStatus("Couldn't reach the page — reload the YouTube tab and retry.");
    } finally {
      setBusy(false);
    }
  }

  /** Jump to a still-open search tab; if it's gone, drop it from the list. */
  async function goToSearch(s: OpenSearch) {
    try {
      const t = await chrome.tabs.get(s.tabId);
      await chrome.tabs.update(s.tabId, { active: true });
      if (t.windowId !== undefined) {
        await chrome.windows.update(t.windowId, { focused: true });
      }
      window.close();
    } catch {
      setOpenSearches(await getOpenSearches());
    }
  }

  /**
   * Re-run a past search by reusing its stored prompt — works even if the
   * original video or destination tab is long gone. Opens the same destination
   * it was sent to before.
   */
  async function askAgain(entry: SearchHistoryEntry) {
    if (!settings) return;
    const dest = getDestination(entry.destinationId);
    const video = { url: entry.videoUrl, title: entry.videoTitle };

    const targetUrl = dest.id === "gemini" ? settings.geminiUrl : dest.url;
    const t = await chrome.tabs.create({ url: targetUrl, active: settings.focusGeminiTab });
    if (t.id !== undefined) {
      await setPendingPrompt(t.id, entry.prompt);
      await addOpenSearch({
        tabId: t.id,
        videoTitle: video.title,
        destinationId: dest.id,
        destinationLabel: dest.label,
        createdAt: new Date().toISOString(),
      });
    }
    window.close();
  }

  function openOptions() {
    void chrome.runtime.openOptionsPage();
    window.close();
  }

  return (
    <div className="tldw">
      <header>
        <img className="brand-icon" src={ICON_URL} alt="" />
        <div className="brand-copy">
          <span className="logo">TL;DW</span>
          <span className="tag">Too Long; Didn't Watch</span>
        </div>
        <button
          className="icon-button"
          onClick={openOptions}
          title="Settings"
          aria-label="Settings"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.92 2.34 2.34 0 0 1 2.33 4.03 2.34 2.34 0 0 0 0 3.82 2.34 2.34 0 0 1-2.33 4.03 2.34 2.34 0 0 0-3.32 1.92 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.92 2.34 2.34 0 0 1-2.33-4.03 2.34 2.34 0 0 0 0-3.82 2.34 2.34 0 0 1 2.33-4.03 2.34 2.34 0 0 0 3.32-1.92Z" />
          </svg>
        </button>
      </header>

      {!ready ? (
        <p className="empty">Checking current tab...</p>
      ) : onVideo ? (
        <p className="video" title={tab?.url}>
          {cleanTitle(tab?.title)}
        </p>
      ) : linkedSearch ? (
        <p className="video" title={linkedSearch.videoUrl}>
          {linkedSearch.videoTitle ?? "YouTube video"}
        </p>
      ) : (
        <p className="empty">Open a YouTube video or Short to use TL;DW.</p>
      )}

      {failures.length > 0 && (
        <div className="status-alert">
          <div className="status-alert-head">
            <span>⚠ Last send didn't work</span>
            <button className="status-clear" onClick={() => void dismissFailures()}>
              Dismiss
            </button>
          </div>
          {failures.slice(0, 3).map((f, i) => (
            <div className="status-alert-item" key={i}>
              <span className="status-alert-site">{f.site}</span>{" "}
              {f.reason ?? "delivery failed"}
              <span className="status-alert-time">{timeAgo(f.at)}</span>
            </div>
          ))}
        </div>
      )}

      {gateSkips.length > 0 && (
        <div className="status-note">
          {gateSkips.slice(0, 2).map((g, i) => (
            <div key={i}>
              ℹ {g.reason ?? "verdict gate skipped"}{" "}
              <span className="status-note-time">({timeAgo(g.at)})</span>
            </div>
          ))}
        </div>
      )}

      {onVideo && (
        <>
          {profiles.length > 0 ? (
            <label className="field">
              <span>Profile</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="empty">
              No prompt profiles found. Open Settings to restore or create one.
            </p>
          )}

          <label className="field">
            <span>Send to</span>
            <select
              value={destinationId}
              onChange={(e) => changeDestination(e.target.value)}
            >
              {DESTINATIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          {getDestination(destinationId).payload !== "link" &&
            getDestination(destinationId).payload !== "source" && (
              <>
                <label className="field">
                  <span>Ask something specific (optional)</span>
                  <input
                    type="text"
                    value={curiosity}
                    placeholder="e.g. Does it cover pricing?"
                    onChange={(e) => setCuriosity(e.target.value)}
                  />
                </label>

                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={gate}
                    onChange={(e) => setGate(e.target.checked)}
                  />
                  <span>Worth-watching verdict first (long videos)</span>
                </label>
              </>
            )}

          <button className="primary" onClick={send} disabled={busy || profiles.length === 0}>
            <SparkIcon />
            {destinationVerb(getDestination(destinationId))}{" "}
            {getDestination(destinationId).label}
          </button>

          <button className="secondary" onClick={() => void showMoments()} disabled={busy}>
            <MomentsIcon />
            Key moments on video
          </button>
          {copyStatus && <p className="copy-status">{copyStatus}</p>}
        </>
      )}

      {linkedSearch?.sourceTabId !== undefined && (
        <>
          <button
            className="secondary"
            onClick={() => void showMoments(linkedSearch)}
            disabled={busy}
          >
            <MomentsIcon />
            Key moments on video
          </button>
          {copyStatus && <p className="copy-status">{copyStatus}</p>}
        </>
      )}

      {!onVideo && !linkedSearch && copyStatus && <p className="copy-status">{copyStatus}</p>}

      {openSearches.filter((s) => s.tabId !== tab?.id).length > 0 && (
        <div className="pop-section">
          <div className="pop-section-title">Open searches</div>
          <div className="search-list">
            {openSearches
              .filter((s) => s.tabId !== tab?.id)
              .map((s) => (
                <button
                  key={s.tabId}
                  className="search-item"
                  onClick={() => void goToSearch(s)}
                  title={s.videoTitle}
                >
                  <span className="search-item-title">
                    {s.videoTitle ?? "YouTube video"}
                  </span>
                  <span className="search-item-meta">
                    {s.destinationLabel} · {timeAgo(s.createdAt)}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="pop-section">
          <div className="pop-section-title">Recent — click to ask again</div>
          <div className="search-list">
            {history.slice(0, 5).map((h) => (
              <button
                key={h.id}
                className="search-item"
                onClick={() => void askAgain(h)}
                disabled={busy}
                title={h.videoTitle}
              >
                <span className="search-item-title">
                  {h.videoTitle ?? "YouTube video"}
                </span>
                <span className="search-item-meta">
                  {h.profileName} · {getDestination(h.destinationId).label} ·{" "}
                  {timeAgo(h.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <footer>
        {onVideo && (
          <span className="hint">
            <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>
            {settings && !settings.autoSubmit ? " · auto-submit off" : ""}
          </span>
        )}
      </footer>

      <div className="version">v{VERSION}</div>
    </div>
  );
}
