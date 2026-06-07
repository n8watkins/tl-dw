import { useEffect, useState } from "react";
import type { SearchHistoryEntry } from "../../types";
import { getHistory } from "../../lib/storage";
import { computeChannelStats, type ChannelStats } from "../../lib/history";

// ---- helpers ----------------------------------------------------------------

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const AVATAR_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

function channelColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function scorePillStyle(score: number | null): { background: string; color: string } {
  if (score === null) return { background: "var(--border)", color: "var(--text)" };
  if (score >= 8) return { background: "#16a34a", color: "#fff" };
  if (score >= 6) return { background: "#d97706", color: "#fff" };
  return { background: "#dc2626", color: "#fff" };
}

type SortKey = "count" | "rating" | "recent";

// ---- Avatar component -------------------------------------------------------

function ChannelAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [imgError, setImgError] = useState(false);
  const showFallback = !avatarUrl || imgError;
  const color = channelColor(name);
  const letter = name.charAt(0).toUpperCase();

  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: showFallback ? color : "transparent",
        color: "#fff",
        fontWeight: 700,
        fontSize: 18,
      }}
    >
      {!showFallback && (
        <img
          src={avatarUrl}
          alt={name}
          onError={() => setImgError(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      {showFallback && letter}
    </div>
  );
}

// ---- Video row inside expanded card -----------------------------------------

function VideoRow({ entry }: { entry: SearchHistoryEntry }) {
  const hasAi = entry.aiRating !== undefined;
  const hasAudience = entry.audienceScore !== undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Title */}
      <button
        onClick={() => void chrome.tabs.create({ url: entry.videoUrl })}
        style={{
          flex: 1,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text)",
          fontSize: 13,
          lineHeight: "1.4",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textDecoration: "underline",
          textDecorationColor: "var(--border)",
          textUnderlineOffset: "2px",
        }}
        title={entry.videoTitle ?? entry.videoUrl}
      >
        {entry.videoTitle ?? entry.videoUrl}
      </button>

      {/* AI rating pill */}
      {hasAi && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            ...scorePillStyle(entry.aiRating!),
          }}
        >
          AI {entry.aiRating}
        </span>
      )}

      {/* Audience score pill */}
      {hasAudience && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            background: "var(--border)",
            color: "var(--text)",
          }}
        >
          Aud {entry.audienceScore}
        </span>
      )}

      {/* Date */}
      <span
        style={{
          flexShrink: 0,
          fontSize: 11,
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          minWidth: 40,
          textAlign: "right",
        }}
      >
        {shortDate(entry.createdAt)}
      </span>
    </div>
  );
}

// ---- Channel card -----------------------------------------------------------

function ChannelCard({ stats }: { stats: ChannelStats }) {
  const [expanded, setExpanded] = useState(false);

  const aiStyle = scorePillStyle(stats.avgAiRating);
  const audStyle = { background: "var(--border)", color: "var(--text)" };

  return (
    <div
      className="card"
      style={{ padding: 0, overflow: "hidden" }}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "12px 16px",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Avatar */}
        <ChannelAvatar name={stats.channel} avatarUrl={stats.avatarUrl} />

        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {stats.channel}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
              flexWrap: "wrap",
            }}
          >
            {/* AI score pill */}
            {stats.avgAiRating !== null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  ...aiStyle,
                }}
              >
                AI {stats.avgAiRating.toFixed(1)}
              </span>
            )}
            {/* Audience score pill */}
            {stats.avgAudienceScore !== null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  ...audStyle,
                }}
              >
                Audience {stats.avgAudienceScore.toFixed(1)}
              </span>
            )}
            {/* Last watched */}
            {stats.lastWatched && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {timeAgo(stats.lastWatched)}
              </span>
            )}
          </div>
        </div>

        {/* Right side: count + chevron */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {stats.count} {stats.count === 1 ? "video" : "videos"}
          </span>
          <span
            style={{
              fontSize: 14,
              color: "var(--text-muted)",
              transition: "transform 0.2s",
              display: "inline-block",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▾
          </span>
        </div>
      </button>

      {/* Expandable video list (CSS grid accordion) */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 0.2s ease",
          overflow: "hidden",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              padding: "4px 16px 8px 16px",
            }}
          >
            {stats.videos.map((v) => (
              <VideoRow key={v.id} entry={v} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Main section -----------------------------------------------------------

export function ChannelsSection() {
  const [channels, setChannels] = useState<ChannelStats[]>([]);
  const [totalVideos, setTotalVideos] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const history = await getHistory();
      const stats = computeChannelStats(history);
      setChannels(stats);
      setTotalVideos(history.filter((e) => !!e.channel).length);
      setLoading(false);
    })();
  }, []);

  const sorted = [...channels].sort((a, b) => {
    if (sortKey === "count") return b.count - a.count;
    if (sortKey === "rating") {
      const ra = a.avgAiRating ?? -Infinity;
      const rb = b.avgAiRating ?? -Infinity;
      return rb - ra;
    }
    // recent
    return new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime();
  });

  return (
    <div>
      {/* Header */}
      <div className="section-header">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 className="section-title">Channels</h1>
            <p className="section-desc">
              Channels you've watched with TL;DW. Scores are averages across all summarized videos from that channel.
            </p>
          </div>
          {channels.length > 0 && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Sort:</span>
              <select
                className="setting-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                style={{ fontSize: 12 }}
              >
                <option value="count">Most watched</option>
                <option value="rating">Highest rated</option>
                <option value="recent">Recent</option>
              </select>
            </div>
          )}
        </div>
        {!loading && channels.length > 0 && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            {channels.length} {channels.length === 1 ? "channel" : "channels"} tracked · {totalVideos} {totalVideos === 1 ? "video" : "videos"} total
          </p>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : channels.length === 0 ? (
        <div className="empty-state">
          No channel data yet. Watch some YouTube videos with TL;DW and your channel history will appear here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((ch) => (
            <ChannelCard key={ch.channel} stats={ch} />
          ))}
        </div>
      )}
    </div>
  );
}
