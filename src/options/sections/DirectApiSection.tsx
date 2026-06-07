import { useEffect, useState } from "react";
import type { GeminiCallEntry, GeminiUsage, PromptProfile, Settings } from "../../types";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../../lib/constants";
import {
  clearGeminiCallLog,
  clearGeminiUsage,
  getGeminiCallLog,
  getGeminiUsage,
  getProfiles,
  getSettings,
  setSettings,
} from "../../lib/storage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";

export function DirectApiSection() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [profiles, setProfiles] = useState<PromptProfile[]>([]);
  const [geminiUsage, setGeminiUsage] = useState<GeminiUsage>({
    totalCalls: 0,
    allTimeCalls: 0,
    todayCalls: 0,
  });
  const [callLog, setCallLog] = useState<GeminiCallEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [pendingKeyName, setPendingKeyName] = useState("");
  const [pendingKeyValue, setPendingKeyValue] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClearStats, setConfirmClearStats] = useState(false);
  const [confirmClearLog, setConfirmClearLog] = useState(false);

  useEffect(() => {
    void Promise.all([getSettings(), getGeminiUsage(), getGeminiCallLog(), getProfiles()]).then(
      ([s, u, log, p]) => {
        setLocal(s);
        setGeminiUsage(u);
        setCallLog(log);
        setProfiles(p);
      },
    );

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
  }

  async function doClearStats() {
    await clearGeminiUsage();
    const u = await getGeminiUsage();
    setGeminiUsage(u);
    setConfirmClearStats(false);
  }

  async function doClearLog() {
    await clearGeminiCallLog();
    setCallLog([]);
    setConfirmClearLog(false);
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

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isYesterday =
      d.toDateString() === new Date(now.getTime() - 86400000).toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (isToday) return `Today ${time}`;
    if (isYesterday) return `Yesterday ${time}`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
  }

  function displayUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.searchParams.get("v")
        ? `youtube.com/watch?v=${u.searchParams.get("v") ?? ""}`
        : url.slice(0, 40);
    } catch {
      return url.slice(0, 40);
    }
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
            gives you ~500 requests/day with Gemini 2.5 Flash — plenty for daily use.
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

      {/* Behavior toggles */}
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

        {profiles.length > 0 && (
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Profile for auto-runs</div>
              <div className="setting-sub">
                Which prompt profile to use when Direct API fires automatically on page load.
                Defaults to your global default profile if not set.
              </div>
            </div>
            <div className="setting-control">
              <select
                value={settings.directApiProfileId ?? ""}
                onChange={(e) => void update({ directApiProfileId: e.target.value || undefined })}
                disabled={!hasKey}
                style={{ fontSize: 13, minWidth: 140 }}
              >
                <option value="">Default profile</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Include comment sentiment</div>
            <div className="setting-sub">
              After the main summary, run a second Gemini call to analyze the top viewer
              comments and add a 💬 Community row to the widget with audience sentiment
              and a score out of 10.
            </div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.includeCommentSentiment}
                onChange={(e) => void update({ includeCommentSentiment: e.target.checked })}
                disabled={!hasKey}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        {settings.includeCommentSentiment && (
          <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="setting-label">Comment prompt template</div>
            <div className="setting-sub" style={{ marginBottom: 6 }}>
              Use <code>{"{{comments}}"}</code> where the scraped comments should be inserted.
            </div>
            <textarea
              value={settings.commentPromptTemplate}
              onChange={(e) => void update({ commentPromptTemplate: e.target.value })}
              rows={7}
              style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {/* Usage stats */}
      <div className="settings-group">
        <div className="settings-group-title"><Icon name="eye" /> Usage</div>

        <div className="card" style={{ marginBottom: 0 }}>
          {/* Always-visible all-time total */}
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                {geminiUsage.allTimeCalls}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                all-time calls
              </div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                {geminiUsage.todayCalls}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                today
              </div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                {geminiUsage.totalCalls}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                since last clear
              </div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>
                {timeAgo(geminiUsage.lastCalledAt)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                last used
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            All-time total is permanent and never cleared.
          </div>
          <button className="btn" onClick={() => setConfirmClearStats(true)}>
            Clear stats
          </button>
        </div>
      </div>

      {/* Per-call history */}
      <div className="settings-group">
        <div className="settings-group-title"><Icon name="clock" /> API call history</div>

        {callLog.length === 0 ? (
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-desc">No API calls recorded yet.</div>
          </div>
        ) : (
          <>
            <div className="history-list" style={{ marginBottom: 12 }}>
              {callLog.map((entry) => {
                const isOpen = openId === entry.id;
                return (
                  <div key={entry.id} className="history-card">
                    <div
                      className="history-row"
                      onClick={() => setOpenId(isOpen ? null : entry.id)}
                    >
                      <div className="history-main">
                        <div className="history-video">
                          {entry.videoTitle || displayUrl(entry.videoUrl)}
                        </div>
                        <div className="history-meta">
                          <span>⚡ Gemini API</span>
                          <span>·</span>
                          <span>{formatTime(entry.at)}</span>
                        </div>
                      </div>
                      <div className="history-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-action"
                          title="Open video"
                          aria-label="Open video"
                          onClick={() => void chrome.tabs.create({ url: entry.videoUrl })}
                        >
                          <Icon name="external" />
                        </button>
                      </div>
                      <span className={`chevron ${isOpen ? "open" : ""}`} style={{ marginLeft: 8 }}>
                        <Icon name="chevron" />
                      </span>
                    </div>

                    <div className={`history-detail-wrapper${isOpen ? " open" : ""}`}>
                      <div className="history-detail-inner">
                        {entry.prompt && (
                          <div className="history-detail">
                            <p className="field-label" style={{ marginBottom: 6 }}>Prompt sent</p>
                            <pre className="prompt-preview">{entry.prompt}</pre>
                          </div>
                        )}
                        {entry.response && (
                          <div className="history-detail" style={{ marginTop: 12 }}>
                            <p className="field-label" style={{ marginBottom: 6 }}>⚡ Gemini API response</p>
                            <pre className="prompt-preview">{entry.response}</pre>
                          </div>
                        )}
                        {!entry.prompt && !entry.response && (
                          <div className="history-detail">
                            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                              No prompt/response stored for this entry.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-danger btn-icon-text" onClick={() => setConfirmClearLog(true)}>
              <Icon name="trash" />
              Clear history
            </button>
          </>
        )}
      </div>

      {confirmClearStats && (
        <ConfirmDialog
          title="Clear usage stats?"
          body="This resets the 'since last clear' counter and today's count. Your all-time total is permanent and will not be affected."
          confirmLabel="Clear Stats"
          tone="primary"
          onCancel={() => setConfirmClearStats(false)}
          onConfirm={() => void doClearStats()}
        />
      )}
      {confirmClearLog && (
        <ConfirmDialog
          title="Clear API call history?"
          body={`This permanently removes all ${callLog.length} entries from the Direct API call log. Usage stats are not affected.`}
          confirmLabel="Clear History"
          onCancel={() => setConfirmClearLog(false)}
          onConfirm={() => void doClearLog()}
        />
      )}
    </div>
  );
}
