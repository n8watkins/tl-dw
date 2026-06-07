import { useEffect, useState } from "react";
import type { GeminiUsage, Settings } from "../../types";
import {
  DEFAULT_SETTINGS,
  DESTINATIONS,
  STORAGE_KEYS,
  WATCH_THRESHOLD_OPTIONS,
} from "../../lib/constants";
import type { WatchThresholdMinutes } from "../../types";
import { clearGeminiUsage, getGeminiUsage, getSettings, setSettings } from "../../lib/storage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DestinationIcon, Icon } from "../components/Icons";

export function SettingsSection() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [geminiUsage, setGeminiUsage] = useState<GeminiUsage>({ totalCalls: 0 });
  const [pendingKeyName, setPendingKeyName] = useState("");
  const [pendingKeyValue, setPendingKeyValue] = useState("");

  useEffect(() => {
    void Promise.all([getSettings(), getGeminiUsage()]).then(([s, u]) => {
      setLocal(s);
      setGeminiUsage(u);
    });

    const handleChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.settings]?.newValue) {
        setLocal({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) });
      }
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

  async function saveApiKey() {
    if (!settings || !pendingKeyValue.trim()) return;
    const next = {
      ...settings,
      geminiApiKey: pendingKeyValue.trim(),
      geminiApiKeyName: pendingKeyName.trim() || "Gemini API key",
    };
    setLocal(next);
    await setSettings(next);
    setPendingKeyName("");
    setPendingKeyValue("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function clearApiKey() {
    if (!settings) return;
    const next = { ...settings, geminiApiKey: "", geminiApiKeyName: "" };
    setLocal(next);
    await setSettings(next);
    await clearGeminiUsage();
    setGeminiUsage({ totalCalls: 0 });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function timeAgo(iso: string | undefined): string {
    if (!iso) return "never";
    const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return "just now";
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
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
        <div className="settings-group-title"><Icon name="eye" /> Auto TL;DW &amp; worth watching</div>

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

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Verdict for long videos</div>
            <div className="setting-sub">
              Long videos lead with a WATCH / SKIM / SKIP verdict. Chat destinations only.
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
              Videos longer than this get the verdict.
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
              One per line. Matching channels or titles always get a full summary.
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
        <div className="settings-group-title"><Icon name="send" /> Direct API — no new tab</div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">Headless Gemini mode</div>
          <div className="card-desc">
            Add a Gemini API key and TL;DW calls Gemini directly — no new tab opens.
            Results arrive in seconds and are injected straight onto the YouTube page.
          </div>
          <div className="card-desc" style={{ marginTop: 8 }}>
            <strong>Get a free key:</strong> Go to{" "}
            <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">
              aistudio.google.com
            </a>{" "}
            → Create API key. No credit card, no billing upgrade needed — the free tier
            gives you ~500 requests/day with Gemini 2.0 Flash, which is plenty for daily use.
            Stay on the free tier.
          </div>
          <div className="card-desc" style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
            Your key is stored only in your browser and sent only to Google's API — never to us.
          </div>

          {settings?.geminiApiKey ? (
            // --- key saved: show name + delete only, never the value ---
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  ✓ {settings.geminiApiKeyName || "Gemini API key"}
                </span>
                <button className="btn btn-danger" onClick={() => void clearApiKey()}>
                  Delete key
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                The key value is not visible after saving. To use a different key, delete this one and add a new one.
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                {geminiUsage.totalCalls === 0
                  ? "No API calls yet."
                  : `${geminiUsage.totalCalls} API call${geminiUsage.totalCalls === 1 ? "" : "s"} · last used ${timeAgo(geminiUsage.lastCalledAt)}`}
              </div>
            </div>
          ) : (
            // --- no key: add form ---
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                value={pendingKeyName}
                onChange={(e) => setPendingKeyName(e.target.value)}
                placeholder="Name this key (e.g. Personal AI Studio key)"
                style={{ fontSize: 13 }}
                autoComplete="off"
              />
              <input
                type="password"
                value={pendingKeyValue}
                onChange={(e) => setPendingKeyValue(e.target.value)}
                placeholder="Paste API key — you won't be able to view it after saving"
                style={{ fontFamily: "monospace", fontSize: 13 }}
                autoComplete="new-password"
                spellCheck={false}
              />
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                The key will be saved immediately. You can delete it later, but you cannot view or edit it.
              </div>
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => void saveApiKey()}
                  disabled={!pendingKeyValue.trim()}
                >
                  Save key
                </button>
              </div>
            </div>
          )}
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
