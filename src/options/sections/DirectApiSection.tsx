import { useEffect, useState } from "react";
import type { GeminiUsage, Settings } from "../../types";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../../lib/constants";
import { clearGeminiUsage, getGeminiUsage, getSettings, setSettings } from "../../lib/storage";
import { Icon } from "../components/Icons";

export function DirectApiSection() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [geminiUsage, setGeminiUsage] = useState<GeminiUsage>({ totalCalls: 0 });
  const [saved, setSaved] = useState(false);
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

  async function saveApiKey() {
    if (!settings || !pendingKeyValue.trim()) return;
    await update({
      geminiApiKey: pendingKeyValue.trim(),
      geminiApiKeyName: pendingKeyName.trim() || "Gemini API key",
    });
    setPendingKeyName("");
    setPendingKeyValue("");
  }

  async function deleteApiKey() {
    if (!settings) return;
    await update({ geminiApiKey: "", geminiApiKeyName: "" });
    await clearGeminiUsage();
    setGeminiUsage({ totalCalls: 0 });
  }

  async function clearUsage() {
    await clearGeminiUsage();
    setGeminiUsage({ totalCalls: 0 });
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

  const hasKey = !!settings.geminiApiKey;

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Direct API</h1>
        <p className="section-desc">
          {saved ? (
            <span className="text-success">Saved.</span>
          ) : (
            "Call Gemini directly on every summarize — no tab opens, regardless of destination."
          )}
        </p>
      </div>

      {/* API key */}
      <div className="settings-group">
        <div className="settings-group-title"><Icon name="send" /> API key</div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-desc">
            <strong>Get a free key:</strong> Go to{" "}
            <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">
              aistudio.google.com
            </a>{" "}
            → Create API key. No credit card, no billing upgrade needed. The free tier
            gives you ~500 requests/day with Gemini 2.0 Flash — plenty for daily use.
            Stay on the free tier.
          </div>
          <div className="card-desc" style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
            Your key is stored only in your browser and sent only to Google's API — never to us.
          </div>

          {hasKey ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  ✓ {settings.geminiApiKeyName || "Gemini API key"}
                </span>
                <button className="btn btn-danger" onClick={() => void deleteApiKey()}>
                  Delete key
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                The key value is not visible after saving. To use a different key, delete this one and add a new one.
              </div>
            </div>
          ) : (
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
                You can delete it later, but you cannot view or edit it.
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

      {/* Behavior toggles — only meaningful when a key is present */}
      <div className="settings-group">
        <div className="settings-group-title"><Icon name="sliders" /> Behavior</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Enabled by default</div>
            <div className="setting-sub">
              When on, every summarize goes through the Gemini API directly — no tab opens,
              regardless of which AI destination is selected. Replaces Alt+Shift+G for getting
              the TL;DW widget. Turn off to fall back to the normal tab-based flow.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.useDirectApi}
                onChange={(e) => void update({ useDirectApi: e.target.checked })}
                disabled={!hasKey}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>
      </div>

      {/* Usage tracking */}
      <div className="settings-group">
        <div className="settings-group-title"><Icon name="eye" /> Usage</div>

        <div className="card" style={{ marginBottom: 0 }}>
          {geminiUsage.totalCalls === 0 ? (
            <div className="card-desc">No API calls recorded yet.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                    {geminiUsage.totalCalls}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    total calls
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                    {timeAgo(geminiUsage.lastCalledAt)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    last used
                  </div>
                </div>
              </div>
              <button className="btn" onClick={() => void clearUsage()}>
                Clear usage stats
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
