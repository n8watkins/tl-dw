import { useEffect, useState } from "react";
import type { HistoryExpiryDays, HistoryLimit, SearchHistoryEntry, Settings } from "../../types";
import { getHistory, getSettings, mutateHistory, setHistory, setSettings } from "../../lib/storage";
import { DEFAULT_SETTINGS, HISTORY_EXPIRY_OPTIONS, STORAGE_KEYS } from "../../lib/constants";
import { expireOldEntries, trimToLimit } from "../../lib/history";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const isToday = d.toDateString() === now.toDateString();
  const isYesterday =
    d.toDateString() === new Date(now.getTime() - 86400000).toDateString();

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (isToday) return `Today at ${time}`;
  if (isYesterday) return `Yesterday at ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function displayUrl(url: string): string {
  try { return new URL(url).hostname.replace("www.", "") + new URL(url).pathname.slice(0, 30); }
  catch { return url.slice(0, 40); }
}

export function HistorySection() {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [stored, loaded] = await Promise.all([getHistory(), getSettings()]);
      const fresh = expireOldEntries(stored, loaded);
      setEntries(fresh);
      setSettingsState(loaded);
      // Persist the prune so storage actually shrinks and the count is honest.
      if (fresh.length !== stored.length) await setHistory(fresh);
    })();
  }, []);

  // Keep in sync with the background while this tab is open: it adds new history
  // entries and updates watch-progress/ratings as the user watches. Without this
  // the page held a stale snapshot and any write below would clobber those
  // changes (real data loss). Mirror settings changes too.
  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes[STORAGE_KEYS.history]) {
        setEntries((changes[STORAGE_KEYS.history].newValue as SearchHistoryEntry[]) ?? []);
      }
      if (changes[STORAGE_KEYS.settings]?.newValue) {
        setSettingsState({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) });
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  async function updateSettings(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettingsState(next);
    await setSettings(next);
    // Re-apply expiry + limit inside the shared history lock (mutateHistory), so
    // a concurrent worker write (WATCH_PROGRESS from any open tab) can't slip
    // between our read and write and get clobbered. The onChanged listener
    // refreshes the visible list.
    await mutateHistory((stored) => {
      const pruned = trimToLimit(expireOldEntries(stored, next), next.historyLimit);
      return pruned.length !== stored.length ? pruned : null;
    });
  }

  async function deleteEntry(id: string) {
    // Recompute from stored history under the lock so a concurrent background
    // write isn't lost.
    await mutateHistory((stored) => stored.filter((e) => e.id !== id));
    setDeleteId(null);
  }

  async function clearAll() {
    await mutateHistory(() => []);
    setConfirmClear(false);
  }

  async function copyPrompt(prompt: string) {
    await navigator.clipboard.writeText(prompt);
  }

  function exportHistory() {
    const payload = {
      exportedAt: new Date().toISOString(),
      source: "TL;DW",
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tl-dw-history-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const filtered = query.trim()
    ? entries.filter(
        (e) =>
          e.videoTitle?.toLowerCase().includes(query.toLowerCase()) ||
          e.videoUrl.toLowerCase().includes(query.toLowerCase()) ||
          e.profileName.toLowerCase().includes(query.toLowerCase()) ||
          e.prompt.toLowerCase().includes(query.toLowerCase()),
      )
    : entries;

  return (
    <div className="history-page">
      <div className="section-header">
        <h1 className="section-title">History</h1>
        <p className="section-desc">
          Prompt and video. Direct API calls also store the Gemini response — expand an entry to see it.
        </p>
      </div>

      <div className="history-toolbar">
        <input
          type="text"
          placeholder="Search by video, profile, or prompt text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {entries.length > 0 && (
          <div className="toolbar-actions">
            <button className="btn btn-ghost btn-icon-text" onClick={exportHistory}>
              <Icon name="download" />
              Export
            </button>
            <button className="btn btn-danger btn-icon-text" onClick={() => setConfirmClear(true)}>
              <Icon name="trash" />
              Clear All
            </button>
          </div>
        )}
      </div>

      {settings && (
        <div className="history-options">
          <div className="history-options-row">
            <div className="history-opt">
              <div className="history-opt-info">
                <span className="history-opt-label">Save history on search</span>
                <span className="history-opt-sub">Records the video, profile, and prompt locally each time you search</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.saveHistoryOnSearch}
                  onChange={(e) => void updateSettings({ saveHistoryOnSearch: e.target.checked })}
                />
                <span className="toggle-track" />
              </label>
            </div>

            <div className="history-opt">
              <span className="history-opt-label">Keep at most</span>
              <select
                className="setting-select"
                value={String(settings.historyLimit)}
                onChange={(e) => {
                  const v = e.target.value;
                  void updateSettings({ historyLimit: (v === "unlimited" ? "unlimited" : Number(v)) as HistoryLimit });
                }}
              >
                <option value="50">50 entries</option>
                <option value="100">100 entries</option>
                <option value="250">250 entries</option>
                <option value="unlimited">Unlimited</option>
              </select>
            </div>

            <div className="history-opt">
              <span className="history-opt-label">Auto-delete old</span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.autoExpireHistory}
                  onChange={(e) => void updateSettings({ autoExpireHistory: e.target.checked })}
                />
                <span className="toggle-track" />
              </label>
            </div>

            <div className="history-opt">
              <span className="history-opt-label">After</span>
              <select
                className="setting-select"
                value={String(settings.historyExpiryDays)}
                disabled={!settings.autoExpireHistory}
                onChange={(e) =>
                  void updateSettings({ historyExpiryDays: Number(e.target.value) as HistoryExpiryDays })
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
      )}

      {entries.length > 0 && (
        <p className="history-stats">
          {filtered.length} of {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </p>
      )}

      <div className="history-scroll">
        {filtered.length === 0 ? (
          <div className="empty-state">
            {entries.length === 0 ? "No search history yet. Run a search from a YouTube video." : "No results for that search."}
          </div>
        ) : (
          <div className="history-list">
            {filtered.map((entry) => {
              const isOpen = openId === entry.id;
              return (
                <div key={entry.id} className="history-card">
                  <div className="history-row" onClick={() => setOpenId(isOpen ? null : entry.id)}>
                    <div className="history-main">
                      <div className="history-video">
                        {entry.videoTitle || displayUrl(entry.videoUrl)}
                      </div>
                      <div className="history-meta">
                        <span>{entry.profileName}</span>
                        <span>·</span>
                        <span>{formatDate(entry.createdAt)}</span>
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
                      <button
                        className="icon-action"
                        title="Copy prompt"
                        aria-label="Copy prompt"
                        onClick={() => void copyPrompt(entry.prompt)}
                      >
                        <Icon name="copy" />
                      </button>
                      <button
                        className="icon-action danger"
                        title="Delete"
                        aria-label="Delete history entry"
                        onClick={() => setDeleteId(entry.id)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                    <span className={`chevron ${isOpen ? "open" : ""}`} style={{ marginLeft: 8 }}>
                      <Icon name="chevron" />
                    </span>
                  </div>

                  <div className={`history-detail-wrapper${isOpen ? " open" : ""}`}>
                    <div className="history-detail-inner">
                      <div className="history-detail">
                        <p className="field-label" style={{ marginBottom: 6 }}>Prompt sent</p>
                        <pre className="prompt-preview">{entry.prompt}</pre>
                      </div>
                      {entry.apiResponse && (
                        <div className="history-detail" style={{ marginTop: 12 }}>
                          <p className="field-label" style={{ marginBottom: 6 }}>⚡ Gemini API response</p>
                          <pre className="prompt-preview">{entry.apiResponse}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear all history?"
          body={`This will permanently delete ${entries.length} saved ${entries.length === 1 ? "history entry" : "history entries"}, including any stored prompts, Gemini API responses, and video URLs.`}
          confirmLabel="Clear History"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => void clearAll()}
        />
      )}
      {deleteId && (
        <ConfirmDialog
          title="Delete this history entry?"
          body="This removes the saved prompt and video URL from TL;DW history."
          confirmLabel="Delete Entry"
          onCancel={() => setDeleteId(null)}
          onConfirm={() => void deleteEntry(deleteId)}
        />
      )}
    </div>
  );
}
