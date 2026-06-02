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
    })();
  }, []);

  const onVideo = isYouTubeVideoUrl(tab?.url);

  async function ask() {
    setBusy(true);
    await chrome.runtime.sendMessage({ type: "ASK", profileId: selectedId });
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
        <div>
          <span className="logo">TL;DW</span>
          <span className="tag">Too Long; Didn't Watch</span>
        </div>
      </header>

      {onVideo ? (
        <p className="video" title={tab?.url}>
          {cleanTitle(tab?.title)}
        </p>
      ) : (
        <p className="empty">Open a YouTube video to use TL;DW.</p>
      )}

      <label className="field">
        <span>Profile</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={!onVideo || profiles.length === 0}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <button className="primary" onClick={ask} disabled={!onVideo || busy}>
        Ask Gemini
      </button>

      <footer>
        <span className="hint">
          <kbd>Alt</kbd>+<kbd>G</kbd>
          {settings && !settings.autoSubmit ? " · auto-submit off" : ""}
        </span>
        <button className="options-link" onClick={openOptions}>
          Settings
        </button>
      </footer>

      <div className="version">v{VERSION}</div>
    </div>
  );
}
