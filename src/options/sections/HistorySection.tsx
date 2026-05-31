import { useEffect, useState } from "react";
import type { SearchHistoryEntry } from "../../types";
import { getHistory, setHistory } from "../../lib/storage";

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

  useEffect(() => {
    void getHistory().then(setEntries);
  }, []);

  async function deleteEntry(id: string) {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    await setHistory(next);
  }

  async function clearAll() {
    if (!confirm("Clear all search history?")) return;
    setEntries([]);
    await setHistory([]);
  }

  async function copyPrompt(prompt: string) {
    await navigator.clipboard.writeText(prompt);
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
        <p className="section-desc">Every search you've sent to Gemini. Prompts only — no responses saved.</p>
      </div>

      <div className="history-toolbar">
        <input
          type="text"
          placeholder="Search by video, profile, or prompt text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {entries.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={clearAll}>
            Clear All
          </button>
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
                      className="btn btn-ghost btn-sm"
                      title="Open video"
                      onClick={() => void chrome.tabs.create({ url: entry.videoUrl })}
                    >
                      ↗
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Copy prompt"
                      onClick={() => void copyPrompt(entry.prompt)}
                    >
                      Copy
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      title="Delete"
                      onClick={() => void deleteEntry(entry.id)}
                    >
                      ✕
                    </button>
                  </div>
                  <span className={`chevron ${isOpen ? "open" : ""}`} style={{ marginLeft: 8 }}>▾</span>
                </div>

                {isOpen && (
                  <div className="history-detail">
                    <div>
                      <p className="field-label" style={{ marginBottom: 6 }}>Prompt sent</p>
                      <pre className="prompt-preview">{entry.prompt}</pre>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => void copyPrompt(entry.prompt)}>
                        Copy Prompt
                      </button>
                      <a
                        href={entry.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                        style={{ textDecoration: "none" }}
                      >
                        Open Video ↗
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
