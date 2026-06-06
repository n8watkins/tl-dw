import { useEffect, useState } from "react";
import type { Destination, PromptProfile, Settings } from "../types";
import { DESTINATIONS, getDestination, isYouTubeVideoUrl } from "../lib/constants";
import { buildDestinationPrompt } from "../lib/promptBuilder";
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
  const [destinationId, setDestinationId] = useState("gemini");

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
      setDestinationId(s.destinationId ?? "gemini");
      setReady(true);
    })();
  }, []);

  const onVideo = isYouTubeVideoUrl(tab?.url);

  // Per-session override only: changing the destination here does NOT touch the
  // saved default (set in Settings). Reopening the popup reverts to the default.
  function changeDestination(id: string) {
    setDestinationId(id);
    setCopyStatus("");
  }

  async function send() {
    const dest = getDestination(destinationId);
    if (dest.mode === "inject") {
      // Gemini: hand off to the background worker's auto-fill flow, passing the
      // session destination so it routes here even if the saved default differs.
      setBusy(true);
      await chrome.runtime.sendMessage({
        type: "ASK",
        profileId: selectedId,
        destinationId: dest.id,
      });
      window.close();
      return;
    }
    await sendViaClipboard(dest);
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
      await chrome.tabs.create({ url: dest.url });
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
