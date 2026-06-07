import { useEffect, useState } from "react";
import type { HistoryLimit, Settings } from "../../types";
import {
  DEFAULT_SETTINGS,
  DESTINATIONS,
  GEMINI_URL,
  HISTORY_EXPIRY_OPTIONS,
  WATCH_THRESHOLD_OPTIONS,
} from "../../lib/constants";
import type { HistoryExpiryDays, WatchThresholdMinutes } from "../../types";
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
            <div className="setting-label">Pause the video on summarize</div>
            <div className="setting-sub">
              Pause the YouTube video you're watching when you send it for a
              summary, so it doesn't keep playing while you read.
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
        <div className="settings-group-title">Worth watching</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Verdict for long videos</div>
            <div className="setting-sub">
              For videos over the length below, the summary leads with a
              WATCH / SKIM / SKIP verdict and a one-line reason before the full
              write-up. Only applies to chat destinations (Gemini, ChatGPT,
              Claude, Perplexity).
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.worthWatchingGate}
                onChange={(e) => void update({ worthWatchingGate: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Length threshold</div>
            <div className="setting-sub">
              Videos longer than this get the verdict. Shorter ones are
              summarized normally.
            </div>
          </div>
          <div className="setting-control">
            <select
              className="setting-select"
              value={String(settings.worthWatchingMinutes)}
              onChange={(e) =>
                void update({
                  worthWatchingMinutes: Number(e.target.value) as WatchThresholdMinutes,
                })
              }
            >
              {WATCH_THRESHOLD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="setting-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div className="setting-info">
            <div className="setting-label">Trusted channels &amp; keywords</div>
            <div className="setting-sub">
              One per line. Videos whose channel name or title contains any of
              these skip the verdict and get a full summary every time.
            </div>
          </div>
          <div style={{ width: "100%" }}>
            <textarea
              rows={4}
              value={settings.gateBypassTerms}
              onChange={(e) => void update({ gateBypassTerms: e.target.value })}
              placeholder={"Veritasium\n3blue1brown\nlecture"}
              style={{ width: "100%", minHeight: 90, resize: "vertical", fontFamily: "inherit", fontSize: 14 }}
            />
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

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Auto-delete old history</div>
            <div className="setting-sub">
              Automatically remove entries older than the age below. Keeps history
              from piling up. Turn off to keep entries until you clear them.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.autoExpireHistory}
                onChange={(e) => void update({ autoExpireHistory: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Delete entries after</div>
            <div className="setting-sub">
              How long an entry is kept before auto-delete removes it.
            </div>
          </div>
          <div className="setting-control">
            <select
              className="setting-select"
              value={String(settings.historyExpiryDays)}
              disabled={!settings.autoExpireHistory}
              onChange={(e) =>
                void update({
                  historyExpiryDays: Number(e.target.value) as HistoryExpiryDays,
                })
              }
            >
              {HISTORY_EXPIRY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
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
              Gemini, ChatGPT, Claude, and Perplexity get the prompt typed in
              automatically; NotebookLM has the transcript added as a source
              automatically. You can override this per-session from the popup
              without changing the default.
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
