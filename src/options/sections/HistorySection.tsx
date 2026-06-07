import { useEffect, useState } from "react";
import type { SearchHistoryEntry } from "../../types";
import { getHistory, getSettings, setHistory } from "../../lib/storage";
import { expireOldEntries } from "../../lib/history";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icons";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function displayUrl(url: string): string {
  try { return new URL(url).hostname.replace("www.", "") + new URL(url).pathname.slice(0, 30); }
  catch { return url.slice(0, 40); }
}

export function HistorySection() {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [stored, settings] = await Promise.all([getHistory(), getSettings()]);
      const fresh = expireOldEntries(stored, settings);
      setEntries(fresh);
      // Persist the prune so storage actually shrinks and the count is honest.
      if (fresh.length !== stored.length) await setHistory(fresh);
    })();
  }, []);

  async function deleteEntry(id: string) {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    await setHistory(next);
    setDeleteId(null);
  }

  async function clearAll() {
    setEntries([]);
    await setHistory([]);
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
    <div>
      <div className="section-header">
        <h1 className="section-title">History</h1>
        <p className="section-desc">
          Prompt and video only — never the transcript or response.
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

      {entries.length > 0 && (
        <p className="history-stats">
          {filtered.length} of {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </p>
      )}

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

                {isOpen && (
                  <div className="history-detail">
                    <div>
                      <p className="field-label" style={{ marginBottom: 6 }}>Prompt sent</p>
                      <pre className="prompt-preview">{entry.prompt}</pre>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-ghost btn-icon-text" onClick={() => void copyPrompt(entry.prompt)}>
                        <Icon name="copy" />
                        Copy Prompt
                      </button>
                      <a
                        href={entry.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-icon-text"
                        style={{ textDecoration: "none" }}
                      >
                        <Icon name="external" />
                        Open Video
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          title="Clear all history?"
          body={`This will permanently delete ${entries.length} saved ${entries.length === 1 ? "history entry" : "history entries"}. Gemini responses are not stored, so only saved prompts and video URLs are affected.`}
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
