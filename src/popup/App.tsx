import { useEffect, useState } from "react";
import type { PromptProfile, Settings } from "../types";
import { isYouTubeVideoUrl } from "../lib/constants";
import { getProfiles, getSettings } from "../lib/storage";

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

  useEffect(() => {
    void (async () => {
      const [p, s, tabs] = await Promise.all([
        getProfiles(),
        getSettings(),
        chrome.tabs.query({ active: true, currentWindow: true }),
      ]);
      setProfiles(p);
      setSettings(s);
      setTab(tabs[0] ?? null);
      setSelectedId(s.defaultProfileId ?? p[0]?.id ?? "");
      setReady(true);
    })();
  }, []);

  const onVideo = isYouTubeVideoUrl(tab?.url);

  async function ask() {
    setBusy(true);
    await chrome.runtime.sendMessage({ type: "ASK", profileId: selectedId });
    window.close();
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

          <button className="primary" onClick={ask} disabled={busy || profiles.length === 0}>
            Ask Gemini
          </button>

          <button className="secondary" onClick={copyTranscript} disabled={busy}>
            Copy transcript
          </button>
          {copyStatus && <p className="copy-status">{copyStatus}</p>}
        </>
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
