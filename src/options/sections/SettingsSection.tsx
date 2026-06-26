import { useEffect, useState } from "react";
import type { Settings } from "../../types";
import {
  DEFAULT_SETTINGS,
  DESTINATIONS,
  STORAGE_KEYS,
} from "../../lib/constants";
import { getSettings, setSettings } from "../../lib/storage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DestinationIcon, Icon } from "../components/Icons";

export function SettingsSection() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);

  function refreshCacheCount() {
    void chrome.storage.local.get("tldwSummaryCache").then((r) => {
      setCacheCount(Object.keys((r["tldwSummaryCache"] as Record<string, unknown>) ?? {}).length);
    });
  }

  async function clearSummaryCache() {
    await chrome.storage.local.remove("tldwSummaryCache");
    refreshCacheCount();
  }

  useEffect(() => {
    void getSettings().then(setLocal);
    refreshCacheCount();

    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.settings]?.newValue) {
        setLocal({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) });
      }
      if (changes["tldwSummaryCache"]) refreshCacheCount();
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    await setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function resetAll() {
    setLocal(DEFAULT_SETTINGS);
    await setSettings(DEFAULT_SETTINGS);
    setConfirmReset(false);
  }


  if (!settings) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Settings</h1>
        <p className="section-desc">
          {saved ? <span className="text-success">Saved.</span> : "Changes save automatically."}
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="sliders" /> Behavior</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Auto-submit</div>
            <div className="setting-sub">
              Press Send automatically. Off lets you review the prompt first.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.autoSubmit}
                onChange={(e) => void update({ autoSubmit: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Switch to the new tab</div>
            <div className="setting-sub">
              Bring the destination tab to the front. Off opens it in the background.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.focusGeminiTab}
                onChange={(e) => void update({ focusGeminiTab: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Pause the video on summarize</div>
            <div className="setting-sub">
              Pause the YouTube video the moment you send it.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.autoPauseOnSummarize}
                onChange={(e) => void update({ autoPauseOnSummarize: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="sparkles" /> Playback</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Auto-skip sponsored segments</div>
            <div className="setting-sub">
              Automatically skip in-video sponsor reads using the free, community-run{" "}
              <a href="https://sponsor.ajay.app" target="_blank" rel="noreferrer">SponsorBlock</a>{" "}
              data — no API key, doesn't touch your Gemini quota. A toast lets you undo any skip.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.skipSponsors}
                onChange={(e) => void update({ skipSponsors: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="clock" /> Summary cache</div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-desc">
            TL;DW stores each video's summary so reloading the page serves it instantly
            instead of re-running (and re-opening a tab). This is where the on-page
            <strong> 💾 Cached</strong> badge points.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {cacheCount} cached summar{cacheCount === 1 ? "y" : "ies"}
            </span>
            <button
              className="btn btn-danger btn-icon-text"
              onClick={() => void clearSummaryCache()}
              disabled={cacheCount === 0}
            >
              <Icon name="trash" />
              Clear all cached summaries
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            Your per-channel ratings and history aren't affected — only the stored summaries.
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="ghost" /> Privacy</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Temporary chats</div>
            <div className="setting-sub">
              Open in incognito mode — chats won't be saved to the AI's history.
              Works on Claude, ChatGPT, and Gemini.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.temporaryChats}
                onChange={(e) => void update({ temporaryChats: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="eye" /> Auto TL;DW</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Auto TL;DW</div>
            <div className="setting-sub">
              Automatically run TL;DW when you open a video longer than this. Off by default.
            </div>
          </div>
          <div className="setting-control">
            <select
              className="setting-select"
              value={String(settings.autoTldwMinutes)}
              onChange={(e) => void update({ autoTldwMinutes: Number(e.target.value) })}
            >
              <option value="0">Off</option>
              {[15, 20, 25, 30, 45, 60].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="send" /> Default destination</div>
        <div className="setting-sub" style={{ marginBottom: 12 }}>
          Where the shortcut and right-click menu send. Override per-session in the popup.
        </div>
        <div className="dest-card-grid">
          {DESTINATIONS.map((d) => (
            <button
              key={d.id}
              className={`dest-card${settings.destinationId === d.id ? " dest-card-active" : ""}`}
              onClick={() => void update({ destinationId: d.id })}
              aria-pressed={settings.destinationId === d.id}
            >
              <DestinationIcon id={d.id} size={36} />
              <span className="dest-card-label">{d.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="reset" /> Reset</div>
        <div className="card">
          <div className="card-title">Reset all settings</div>
          <div className="card-desc" style={{ marginBottom: 16 }}>
            Restore defaults. Profiles and history are untouched.
          </div>
          <button className="btn btn-danger btn-icon-text" onClick={() => setConfirmReset(true)}>
            <Icon name="reset" />
            Reset to Defaults
          </button>
        </div>
      </div>
      {confirmReset && (
        <ConfirmDialog
          title="Reset all settings?"
          body="This restores TL;DW settings to their defaults. Profiles and search history are not changed."
          confirmLabel="Reset Settings"
          tone="primary"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => void resetAll()}
        />
      )}
    </div>
  );
}
