import { useEffect, useState } from "react";
import type { HistoryLimit, Settings } from "../../types";
import { DEFAULT_SETTINGS, DESTINATIONS, GEMINI_URL } from "../../lib/constants";
import { getSettings, setSettings } from "../../lib/storage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";

export function SettingsSection() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    void getSettings().then(setLocal);
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
        <div className="settings-group-title">Behavior</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Auto-submit</div>
            <div className="setting-sub">
              Automatically press Send after filling the prompt box (Gemini,
              ChatGPT, Claude). Turn off to review the prompt before it sends.
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
              Bring the new destination tab to the front. Turn off to open it in
              the background and stay on the YouTube video you're watching.
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
            <div className="setting-label">Save history on search</div>
            <div className="setting-sub">
              Log the prompt and video URL each time you search. Nothing from
              Gemini's response is ever saved.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.saveHistoryOnSearch}
                onChange={(e) => void update({ saveHistoryOnSearch: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">History</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">History limit</div>
            <div className="setting-sub">
              Maximum number of search entries to keep. Oldest entries are
              removed when the limit is reached.
            </div>
          </div>
          <div className="setting-control">
            <select
              className="setting-select"
              value={String(settings.historyLimit)}
              onChange={(e) => {
                const v = e.target.value;
                void update({ historyLimit: (v === "unlimited" ? "unlimited" : Number(v)) as HistoryLimit });
              }}
            >
              <option value="50">50 entries</option>
              <option value="100">100 entries</option>
              <option value="250">250 entries</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Destination</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Default destination</div>
            <div className="setting-sub">
              Where the right-click menu and keyboard shortcut send summaries.
              Gemini is filled in automatically; ChatGPT, Claude, NotebookLM, and
              Perplexity open with the prompt and transcript copied to your
              clipboard, ready to paste. You can override this per-session from
              the popup without changing the default.
            </div>
          </div>
          <div className="setting-control">
            <select
              className="setting-select"
              value={settings.destinationId}
              onChange={(e) => void update({ destinationId: e.target.value })}
            >
              {DESTINATIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Gemini</div>

        <div className="setting-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div className="setting-info">
            <div className="setting-label">Gemini URL</div>
            <div className="setting-sub">
              The URL TL;DW opens for Gemini. Only change this if Google moves
              Gemini to a different address.
            </div>
          </div>
          <div style={{ width: "100%" }}>
            <input
              type="text"
              value={settings.geminiUrl}
              onChange={(e) => void update({ geminiUrl: e.target.value })}
              placeholder={GEMINI_URL}
            />
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Reset</div>
        <div className="card">
          <div className="card-title">Reset all settings</div>
          <div className="card-desc" style={{ marginBottom: 16 }}>
            Restores all settings to their defaults. Your profiles and search
            history are not affected.
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
