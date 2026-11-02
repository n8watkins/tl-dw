import { useEffect, useRef, useState } from "react";
import type {
  DeliveryStatus,
  OpenSearch,
  PromptProfile,
  SearchHistoryEntry,
  Settings,
} from "../types";
import {
  AI_STUDIO_LINKS,
  DEFAULT_SETTINGS,
  DESTINATIONS,
  destinationVerb,
  getDestination,
  isYouTubeVideoUrl,
  isYouTubeShortUrl,
  STORAGE_KEYS,
} from "../lib/constants";
import { requestDestinationAccess } from "../lib/permissions";
import { useSummarizeShortcut } from "../lib/useShortcut";
import { DestinationIcon } from "../lib/DestinationIcon";
import {
  clearDeliveryStatuses,
  getDeliveryStatuses,
  getGeminiUsage,
  getHistory,
  getOpenSearches,
  getProfiles,
  getSettings,
  setSettings as saveSettings,
} from "../lib/storage";
import type { GeminiUsage, VideoMeta } from "../types";
import { emptyGeminiUsage } from "../lib/geminiUsage";

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

function YouTubeIcon() {
  return (
    <svg width={20} height={14} viewBox="0 0 20 14" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <rect width="20" height="14" rx="3" fill="#FF0000" />
      <polygon points="8,3.5 8,10.5 14.5,7" fill="white" />
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
  const [ready, setReady] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [destinationId, setDestinationId] = useState("gemini");
  const [curiosity, setCuriosity] = useState("");
  // The optional "ask something specific" field starts collapsed to keep the
  // popup short; expands on demand (or if it already holds text).
  const [showCuriosity, setShowCuriosity] = useState(false);
  const [openSearches, setOpenSearches] = useState<OpenSearch[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [statuses, setStatuses] = useState<DeliveryStatus[]>([]);
  const [geminiUsage, setGeminiUsage] = useState<GeminiUsage>(emptyGeminiUsage());
  // What the YouTube page says about its video: a live broadcast or an
  // unavailable video has nothing to summarize, so the popup says so.
  const [pageMeta, setPageMeta] = useState<VideoMeta | null>(null);
  const shortcut = useSummarizeShortcut();
  // Whether the user has made an in-popup choice this session. Once they have,
  // a settings write (e.g. ticking Direct API) must NOT revert it back to the
  // saved default via the storage.onChanged listener below.
  const destOverridden = useRef(false);

  useEffect(() => {
    void (async () => {
      const [p, s, tabs, open, hist, stat, usage] = await Promise.all([
        getProfiles(),
        getSettings(),
        chrome.tabs.query({ active: true, currentWindow: true }),
        getOpenSearches(),
        getHistory(),
        getDeliveryStatuses(),
        getGeminiUsage(),
      ]);
      setProfiles(p);
      setSettings(s);
      const activeTab = tabs[0] ?? null;
      setTab(activeTab);
      setSelectedId(s.defaultProfileId ?? p[0]?.id ?? "");
      setDestinationId(s.destinationId ?? "gemini");
      setOpenSearches(open);
      setHistory(hist);
      setStatuses(stat);
      setGeminiUsage(usage);
      if (activeTab?.id !== undefined && isYouTubeVideoUrl(activeTab.url)) {
        const meta = (await chrome.tabs.sendMessage(activeTab.id, { type: "GET_VIDEO_META" })
          .catch(() => null)) as VideoMeta | null;
        setPageMeta(meta);
      }
      setReady(true);
    })();
  }, []);

  // Keep settings in sync if the options page (or any other tab) writes them
  // while the popup is open. Re-read the fresh value and update the derived
  // state that drives the Direct API indicator and key presence. The destination
  // is a session-local override — only updated when the user hasn't made an
  // in-popup choice yet (i.e. still at default).
  useEffect(() => {
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes[STORAGE_KEYS.settings]?.newValue) {
        const fresh: Settings = { ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) };
        setSettings(fresh);
        // Only sync destination from storage if the user hasn't overridden it in
        // this popup session — otherwise ticking "Direct API" (which writes
        // settings, firing this listener) would silently reset their just-picked
        // destination.
        if (!destOverridden.current) setDestinationId(fresh.destinationId ?? "gemini");
      }
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
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

  async function dismissFailures() {
    await clearDeliveryStatuses();
    setStatuses([]);
  }

  // Watch pages only. TL;DW is deliberately unavailable on Shorts: the popup
  // says so and offers no send controls. The same goes for a broadcast that is
  // live right now and for a video YouTube can't play.
  const onWatchPage = isYouTubeVideoUrl(tab?.url);
  const liveNow = onWatchPage && !!pageMeta?.current && !!pageMeta.live;
  const unavailable = onWatchPage && !!pageMeta?.current && !!pageMeta.unavailable;
  const onVideo = onWatchPage && !liveNow && !unavailable;
  const onShort = isYouTubeShortUrl(tab?.url);
  // When Direct API is configured + enabled and Gemini is the destination, the
  // popup can summarize inline on the page (no tab), matching the on-page button.
  const canInline = !!(
    settings?.geminiApiKey?.trim() &&
    settings?.useDirectApi &&
    destinationId === "gemini"
  );
  // If the current tab is a destination tab TL;DW opened, link it back to source.
  const linkedSearch = openSearches.find((s) => s.tabId === tab?.id);

  // Per-session override only: changing the destination here does NOT touch the
  // saved default (set in Settings). Reopening the popup reverts to the default.
  function changeDestination(id: string) {
    setCopyStatus("");
    // ChatGPT, Claude and NotebookLM need the user's permission for their site;
    // ask now, inside the click (it resolves at once when already allowed).
    void requestDestinationAccess(id).then((granted) => {
      if (!granted) {
        setCopyStatus(`${getDestination(id).label} needs your permission so TL;DW can open it and type the prompt.`);
        return;
      }
      destOverridden.current = true;
      setDestinationId(id);
    });
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
      sourceTabId: tab?.id,
      profileId: selectedId,
      destinationId: dest.id,
      userCuriosity: curiosity.trim() || undefined,
      // In Direct-API + Gemini mode, "popup-inline" summarizes on the page with
      // no tab (like the on-page button). Otherwise "popup" is an explicit
      // request to open that destination, so it opens a tab even with Direct
      // API enabled (unlike auto-runs).
      source: canInline ? "popup-inline" : "popup",
    });
    window.close();
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

  /** Open a recent video in a new tab (summarizing it again is one click there). */
  function openRecent(entry: SearchHistoryEntry) {
    void chrome.tabs.create({ url: entry.videoUrl, active: true });
    window.close();
  }

  function openWelcome() {
    void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS", section: "welcome" });
    window.close();
  }

  function dismissFirstRun() {
    if (!settings) return;
    const next = { ...settings, firstRunNoticeSeen: true };
    setSettings(next);
    void saveSettings(next);
  }

  function openOptions() {
    void chrome.runtime.openOptionsPage();
    window.close();
  }

  async function goToVideoTab() {
    if (onVideo) {
      window.close();
      return;
    }
    if (linkedSearch) {
      if (linkedSearch.sourceTabId !== undefined) {
        try {
          const t = await chrome.tabs.get(linkedSearch.sourceTabId);
          await chrome.tabs.update(linkedSearch.sourceTabId, { active: true });
          if (t.windowId !== undefined) {
            await chrome.windows.update(t.windowId, { focused: true });
          }
          window.close();
          return;
        } catch {
          // source tab closed — fall through to reopen
        }
      }
      if (linkedSearch.videoUrl) {
        await chrome.tabs.create({ url: linkedSearch.videoUrl, active: true });
      }
      window.close();
    }
  }

  return (
    <div className="tldw">
      <header>
        <img className="brand-icon" src={ICON_URL} alt="" />
        <div className="brand-copy">
          <span className="logo">TL;DW</span>
          <span className="tag">Too Long; Didn't Watch</span>
        </div>
        <span className="header-version">v{VERSION}</span>
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

      {settings && !settings.firstRunNoticeSeen && !settings.geminiApiKey && (
        <div className="first-run-notice" role="note">
          <p>
            Works without a key: TL;DW opens Gemini in a tab.{" "}
            <button type="button" className="first-run-link" onClick={openWelcome}>
              Add a free Gemini key
            </button>{" "}
            (about 2 minutes) for summaries right on the page.
          </p>
          <button
            type="button"
            className="first-run-dismiss"
            aria-label="Dismiss this tip"
            title="Dismiss"
            onClick={dismissFirstRun}
          >
            ✕
          </button>
        </div>
      )}

      {!ready ? (
        <p className="empty">Checking current tab...</p>
      ) : onVideo ? (
        <button className="video-btn" onClick={() => void goToVideoTab()} title={tab?.url}>
          <YouTubeIcon />
          <span className="video-btn-title">{cleanTitle(tab?.title)}</span>
        </button>
      ) : liveNow ? (
        <p className="status-note" role="status">
          This is a live stream. TL;DW can summarize it once the broadcast ends.
        </p>
      ) : unavailable ? (
        <p className="status-note" role="status">
          YouTube can't play this video here, so there's nothing for TL;DW to summarize.
        </p>
      ) : onShort ? (
        <p className="empty shorts-note" role="status">
          TL;DW isn't available on YouTube Shorts.
        </p>
      ) : linkedSearch ? (
        <button className="video-btn" onClick={() => void goToVideoTab()} title={linkedSearch.videoUrl}>
          <YouTubeIcon />
          <span className="video-btn-title">{linkedSearch.videoTitle ?? "YouTube video"}</span>
        </button>
      ) : (
        <p className="empty">Open a YouTube video to use TL;DW.</p>
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

      {onVideo && (
        <>
          <div className="dest-grid">
            {DESTINATIONS.map((d) => (
              <button
                key={d.id}
                className={`dest-btn${destinationId === d.id ? " dest-btn-active" : ""}`}
                onClick={() => changeDestination(d.id)}
                aria-pressed={destinationId === d.id}
                title={d.label}
              >
                <DestinationIcon id={d.id} size={26} />
                <span>{d.label}</span>
              </button>
            ))}
          </div>

          {profiles.length === 0 ? (
            <p className="empty">
              No prompt profiles found. Open Settings to restore or create one.
            </p>
          ) : (
            <div className="send-row">
              <select
                className="profile-select"
                aria-label="Prompt profile"
                title="Prompt profile"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="ask-btn" onClick={send}>
                <SparkIcon />
                <span className="ask-btn-label">
                  {canInline ? (
                    <>
                      <span>Summarize inline</span>
                      <span className="ask-btn-shortcut">no new tab</span>
                    </>
                  ) : (
                    <>
                      <span>{destinationVerb(getDestination(destinationId))} {getDestination(destinationId).label}</span>
                      {shortcut && destinationId === settings?.destinationId && (
                        <span className="ask-btn-shortcut">{shortcut}</span>
                      )}
                    </>
                  )}
                </span>
              </button>
            </div>
          )}

          {settings?.geminiApiKey && (
            <div className="headless-row">
              <label className="check-field" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={settings.useDirectApi ?? false}
                  onChange={(e) => {
                    const next = { ...settings, useDirectApi: e.target.checked };
                    setSettings(next);
                    void saveSettings(next);
                  }}
                />
                <span>⚡ Direct API (no new tab)</span>
              </label>
              {settings.useDirectApi && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="headless-count">
                    {geminiUsage.attemptsToday} attempt{geminiUsage.attemptsToday === 1 ? "" : "s"} today
                  </span>
                  <button
                    className="section-link"
                    onClick={() => {
                      void chrome.tabs.create({ url: AI_STUDIO_LINKS.usage });
                      window.close();
                    }}
                  >
                    View usage →
                  </button>
                </div>
              )}
            </div>
          )}

          {getDestination(destinationId).payload !== "link" &&
            getDestination(destinationId).payload !== "source" &&
            (showCuriosity || curiosity ? (
              <label className="field">
                <span>Ask something specific (optional)</span>
                <textarea
                  value={curiosity}
                  placeholder="e.g. Does it cover pricing?"
                  onChange={(e) => setCuriosity(e.target.value)}
                  rows={3}
                  autoFocus
                />
              </label>
            ) : (
              <button
                type="button"
                className="add-curiosity"
                onClick={() => setShowCuriosity(true)}
              >
                + Ask something specific
              </button>
            ))}

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
          <div className="pop-section-title">
            <span>Recent</span>
            <button className="section-link" onClick={openOptions}>History →</button>
          </div>
          <div className="search-list">
            {history.slice(0, 2).map((h) => (
              <button
                key={h.id}
                className="search-item"
                onClick={() => openRecent(h)}
                title={`Open ${h.videoTitle ?? "this video"}`}
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

      <a
        className="kofi-link"
        href="https://ko-fi.com/n8watkins"
        target="_blank"
        rel="noopener noreferrer"
      >
        ☕ Buy me a Ko-fi
      </a>
    </div>
  );
}
