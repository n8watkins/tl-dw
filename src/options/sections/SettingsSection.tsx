import { useEffect, useState } from "react";
import type { Settings } from "../../types";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../../lib/constants";
import { getSettings, setSettings } from "../../lib/storage";
import { hasSponsorBlockAccess, requestSponsorBlockAccess } from "../../lib/permissions";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";

export function SettingsSection() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);

  function refreshCacheCount() {
    void chrome.runtime.sendMessage({ type: "CACHE_COUNT" }).then((result) => {
      setCacheCount((result as { count?: number } | undefined)?.count ?? 0);
    });
  }

  async function clearSummaryCache() {
    await chrome.runtime.sendMessage({ type: "CACHE_CLEAR" });
    refreshCacheCount();
  }

  useEffect(() => {
    void (async () => {
      const loaded = await getSettings();
      // SponsorBlock on without its permission (e.g. removed in Chrome's
      // extension settings) can't fetch anything: show it as off.
      if (loaded.skipSponsors && !(await hasSponsorBlockAccess())) {
        const next = { ...loaded, skipSponsors: false };
        await setSettings(next);
        setLocal(next);
      } else {
        setLocal(loaded);
      }
    })();
    refreshCacheCount();

    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.settings]?.newValue) {
        setLocal({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) });
      }
      if (changes["tldwSummaryCache"]) refreshCacheCount();
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    await setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  /** Turning SponsorBlock on asks Chrome for access to its API first (it needs the click). */
  async function toggleSponsorBlock(on: boolean) {
    if (!on) {
      await update({ skipSponsors: false });
      return;
    }
    const granted = await requestSponsorBlockAccess();
    await update({ skipSponsors: granted });
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
            <div className="setting-label" id="settings-autosubmit">Auto-submit</div>
            <div className="setting-sub">
              Without a key, press Send in the Gemini tab automatically. Off lets you review the prompt first.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                aria-labelledby="settings-autosubmit"
                checked={settings.autoSubmit}
                onChange={(e) => void update({ autoSubmit: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label" id="settings-focus">Switch to the new tab</div>
            <div className="setting-sub">
              Without a key, bring the Gemini tab to the front when you send from the popup, the
              keyboard shortcut or the right-click menu. Sends from the YouTube page always open it in
              the background, so the video keeps playing in front.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                aria-labelledby="settings-focus"
                checked={settings.focusGeminiTab}
                onChange={(e) => void update({ focusGeminiTab: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label" id="settings-pause">Pause the video on summarize</div>
            <div className="setting-sub">
              Pause the YouTube video the moment you send it.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                aria-labelledby="settings-pause"
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
            <div className="setting-label" id="settings-sponsorblock">Auto-skip sponsored segments</div>
            <div className="setting-sub">
              Skip sponsor reads using the community-run{" "}
              <a href="https://sponsor.ajay.app" target="_blank" rel="noreferrer">SponsorBlock</a>{" "}
              data. Off by default: when on, TL;DW sends the ID of each video you open (and
              nothing else) to the SponsorBlock API at sponsor.ajay.app to look up its sponsor
              times, and Chrome asks you to allow that site. The TL;DW panel lets you undo a skip.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                aria-labelledby="settings-sponsorblock"
                checked={settings.skipSponsors}
                onChange={(e) => void toggleSponsorBlock(e.target.checked)}
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
            Your history isn't affected, only the stored summaries.
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title"><Icon name="ghost" /> Privacy</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label" id="settings-temporary">Temporary chats</div>
            <div className="setting-sub">
              Without a key, open Gemini in a temporary chat, so it isn't saved to your Gemini history.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                aria-labelledby="settings-temporary"
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
            <div className="setting-label" id="settings-auto-tldw">Summarize long videos automatically</div>
            <div className="setting-sub">
              Run TL;DW by itself when you open a video longer than this. Off by default.
            </div>
          </div>
          <div className="setting-control">
            <select
              className="setting-select"
              aria-labelledby="settings-auto-tldw"
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
