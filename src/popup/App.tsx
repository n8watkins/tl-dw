import { useEffect, useState } from "react";
import type {
  DeliveryStatus,
  Destination,
  OpenSearch,
  PromptProfile,
  SearchHistoryEntry,
  Settings,
} from "../types";
import { DESTINATIONS, getDestination, isYouTubeVideoUrl } from "../lib/constants";
import { buildDestinationPrompt } from "../lib/promptBuilder";
import { addHistoryEntry } from "../lib/history";
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

  const failures = statuses.filter((s) => !s.ok);

  async function dismissFailures() {
    await clearDeliveryStatuses();
    setStatuses([]);
  }

  const onVideo = isYouTubeVideoUrl(tab?.url);

  // Per-session override only: changing the destination here does NOT touch the
  // saved default (set in Settings). Reopening the popup reverts to the default.
  function changeDestination(id: string) {
    setDestinationId(id);
    setCopyStatus("");
  }

  function send() {
    const dest = getDestination(destinationId);
    if (dest.mode === "inject") {
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
      });
      window.close();
      return;
    }
    void sendViaClipboard(dest);
  }

  /**
   * For destinations we can't auto-fill (ChatGPT, Claude, …): build the prompt
   * with the transcript, copy it, and open the site to paste into. Runs in the
   * popup so the clipboard write happens under a user gesture.
   */
  async function sendViaClipboard(dest: Destination) {
    if (!tab?.id || !tab.url) return;
    const profile = profiles.find((p) => p.id === selectedId) ?? profiles[0];
    if (!profile) return;

    setBusy(true);
    setCopyStatus(`Preparing for ${dest.label}…`);
    try {
      const res = (await chrome.tabs
        .sendMessage(tab.id, { type: "GET_TRANSCRIPT" })
        .catch(() => null)) as { transcript: string | null } | null;
      const transcript = res?.transcript ?? null;
      const full = buildDestinationPrompt(
        profile,
        { url: tab.url, title: cleanTitle(tab.title) },
        dest,
        transcript,
      );

      await navigator.clipboard.writeText(full);
      const opened = await chrome.tabs.create({ url: dest.url });
      const video = { url: tab.url, title: cleanTitle(tab.title) };
      if (opened.id !== undefined) {
        await addOpenSearch({
          tabId: opened.id,
          videoTitle: video.title,
          destinationId: dest.id,
          destinationLabel: dest.label,
          createdAt: new Date().toISOString(),
        });
      }
      if (settings?.saveHistoryOnSearch) {
        await addHistoryEntry({ video, profile, prompt: full, settings, destinationId: dest.id });
      }
      if (dest.payload === "source") {
        setCopyStatus(
          transcript
            ? `Copied transcript — in ${dest.label}, click "Copied text" and paste.`
            : `No transcript found — copied the video link instead.`,
        );
      } else {
        setCopyStatus(
          transcript
            ? `Copied with transcript — paste into ${dest.label} (Ctrl+V).`
            : `Copied (no transcript found) — paste into ${dest.label} (Ctrl+V).`,
        );
      }
    } catch {
      setCopyStatus("Couldn't prepare the prompt — reload the YouTube tab and retry.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Grab the current video's transcript from its content script and copy it to
   * the clipboard. Deliberately separate from the Ask Gemini flow so it can't
   * slow it down or break it, and so it's visibly testable on its own.
   */
  async function copyTranscript() {
    if (!tab?.id) return;
    setBusy(true);
    setCopyStatus("Fetching transcript…");
    try {
      const res = (await chrome.tabs.sendMessage(tab.id, {
        type: "GET_TRANSCRIPT",
      })) as { transcript: string | null } | undefined;
      const transcript = res?.transcript;
      if (!transcript) {
        setCopyStatus("No transcript found (does this video have captions?).");
        return;
      }
      await navigator.clipboard.writeText(transcript);
      setCopyStatus(`Copied ${transcript.length.toLocaleString()} characters.`);
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

    if (dest.mode === "inject") {
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
      return;
    }

    setBusy(true);
    try {
      await navigator.clipboard.writeText(entry.prompt);
      const t = await chrome.tabs.create({ url: dest.url });
      if (t.id !== undefined) {
        await addOpenSearch({
          tabId: t.id,
          videoTitle: video.title,
          destinationId: dest.id,
          destinationLabel: dest.label,
          createdAt: new Date().toISOString(),
        });
      }
      setCopyStatus(`Re-opened ${dest.label} — paste (Ctrl+V).`);
    } finally {
      setBusy(false);
    }
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
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={gate}
                  onChange={(e) => setGate(e.target.checked)}
                />
                <span>Worth-watching verdict first (long videos)</span>
              </label>
            )}

          <button className="primary" onClick={send} disabled={busy || profiles.length === 0}>
            {getDestination(destinationId).mode === "inject"
              ? `Ask ${getDestination(destinationId).label}`
              : `Copy & open ${getDestination(destinationId).label}`}
          </button>

          <button className="secondary" onClick={copyTranscript} disabled={busy}>
            Copy transcript
          </button>
          {copyStatus && <p className="copy-status">{copyStatus}</p>}
        </>
      )}

      {!onVideo && copyStatus && <p className="copy-status">{copyStatus}</p>}

      {openSearches.length > 0 && (
        <div className="pop-section">
          <div className="pop-section-title">Open searches</div>
          <div className="search-list">
            {openSearches.map((s) => (
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
