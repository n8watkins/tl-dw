import { useEffect, useState, useCallback } from "react";
import type { AutoRunChannel, BlockedChannel, SearchHistoryEntry } from "../../types";
import { getHistory, getAutoRunChannels, setAutoRunChannels as persistAutoRunChannels, getBlockedChannels, removeBlockedChannel, getSettings } from "../../lib/storage";
import { computeChannelStats, type ChannelStats } from "../../lib/history";
import { USER_RATING_LABELS, scoreToVerdict, userAvgToLabel } from "../../lib/constants";
import { TierBadge } from "../components/TierBadge";

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

/** Pill colors for a WATCH/SKIM/SKIP verdict (shared by AI + audience pills). */
function verdictPillStyle(verdict: string): { background: string; color: string } {
  if (verdict === "WATCH") return { background: "#16a34a", color: "#fff" };
  if (verdict === "SKIM") return { background: "#d97706", color: "#fff" };
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

// ---- Auto-run channel card --------------------------------------------------

function AutoRunCard({
  channel,
  onRemove,
}: {
  channel: AutoRunChannel;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className="card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
      }}
    >
      <ChannelAvatar name={channel.name} avatarUrl={channel.avatarUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {channel.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          Added {timeAgo(channel.addedAt)}
        </div>
      </div>
      <button
        onClick={() => onRemove(channel.id)}
        style={{
          flexShrink: 0,
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        Remove
      </button>
    </div>
  );
}

// ---- Blocked channel card ---------------------------------------------------

function BlockedCard({
  channel,
  onUnblock,
}: {
  channel: BlockedChannel;
  onUnblock: (id: string) => void;
}) {
  return (
    <div
      className="card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        opacity: 0.8,
      }}
    >
      <ChannelAvatar name={channel.name} avatarUrl={channel.avatarUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {channel.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          Blocked {timeAgo(channel.addedAt)}
        </div>
      </div>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: "2px 6px",
          borderRadius: 999,
          background: "#dc2626",
          color: "#fff",
          whiteSpace: "nowrap",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        BLOCKED
      </span>
      <button
        onClick={() => onUnblock(channel.id)}
        style={{
          flexShrink: 0,
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        Unblock
      </button>
    </div>
  );
}

// ---- Video row inside expanded card -----------------------------------------

function VideoRow({ entry, trackMyAverage }: { entry: SearchHistoryEntry; trackMyAverage: boolean }) {
  const hasAi = entry.aiRating !== undefined;
  const hasUserRating = trackMyAverage && entry.userRating !== undefined;

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

      {/* AI verdict pill */}
      {hasAi && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            ...verdictPillStyle(scoreToVerdict(entry.aiRating!)),
          }}
        >
          AI {scoreToVerdict(entry.aiRating!)}
        </span>
      )}

      {/* Auto-tracked engagement pill */}
      {hasUserRating && (
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
          title="Auto-tracked engagement"
        >
          Auto: {USER_RATING_LABELS[entry.userRating!]}
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

// ---- History channel card ---------------------------------------------------

function ChannelCard({
  stats,
  isAutoRun,
  onToggleAutoRun,
  trackMyAverage,
}: {
  stats: ChannelStats;
  isAutoRun: boolean;
  onToggleAutoRun: (stats: ChannelStats, enable: boolean) => void;
  trackMyAverage: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

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
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
            {isAutoRun && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 999,
                  background: "#1a73e8",
                  color: "#fff",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.04em",
                }}
              >
                AUTO
              </span>
            )}
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
            {/* AI verdict pill */}
            {stats.avgAiRating !== null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  ...verdictPillStyle(scoreToVerdict(stats.avgAiRating)),
                }}
                title={`Based on ${stats.count} ${stats.count === 1 ? "video" : "videos"}`}
              >
                AI usually {scoreToVerdict(stats.avgAiRating)}
              </span>
            )}
            {/* Auto-tracked engagement pill */}
            {trackMyAverage && stats.avgUserRating !== null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  background: "var(--border)",
                  color: "var(--text)",
                }}
                title={`Auto-tracked: Engaged ${stats.userBreakdown.engaged} · Skimmed ${stats.userBreakdown.skimmed} · Skipped ${stats.userBreakdown.skipped}`}
              >
                Auto: usually {userAvgToLabel(stats.avgUserRating)}
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
              <VideoRow key={v.id} entry={v} trackMyAverage={trackMyAverage} />
            ))}
            {/* Auto-run toggle at the bottom of expanded card */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 10,
                marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                id={`auto-run-${stats.channel}`}
                checked={isAutoRun}
                style={{ cursor: "pointer", accentColor: "#1a73e8" }}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleAutoRun(stats, e.target.checked);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <label
                htmlFor={`auto-run-${stats.channel}`}
                style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                Auto-run for this channel
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Main section -----------------------------------------------------------

export function ChannelsSection() {
  const [channels, setChannels] = useState<ChannelStats[]>([]);
  const [autoRunChannels, setAutoRunChannels] = useState<AutoRunChannel[]>([]);
  const [blockedChannels, setBlockedChannels] = useState<BlockedChannel[]>([]);
  const [totalVideos, setTotalVideos] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [loading, setLoading] = useState(true);
  const [trackMyAverage, setTrackMyAverage] = useState(true);

  const reload = useCallback(async () => {
    const [history, autoRun, blocked, settings] = await Promise.all([
      getHistory(), getAutoRunChannels(), getBlockedChannels(), getSettings(),
    ]);
    const stats = computeChannelStats(history);
    setChannels(stats);
    setAutoRunChannels(autoRun);
    setBlockedChannels(blocked);
    setTotalVideos(history.filter((e) => !!e.channel).length);
    setTrackMyAverage(settings.trackMyAverage);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleRemoveAutoRun = useCallback(async (channelId: string) => {
    const current = await getAutoRunChannels();
    const updated = current.filter((c) => c.id !== channelId && c.name !== channelId);
    await persistAutoRunChannels(updated);
    setAutoRunChannels(updated);
  }, []);

  const handleUnblock = useCallback(async (channelId: string) => {
    await removeBlockedChannel(channelId);
    setBlockedChannels((prev) => prev.filter((c) => c.id !== channelId && c.name !== channelId));
  }, []);

  const handleToggleAutoRun = useCallback(async (stats: ChannelStats, enable: boolean) => {
    const current = await getAutoRunChannels();
    const existing = current.find((c) => c.name === stats.channel);
    let updated: AutoRunChannel[];
    if (enable) {
      const entry: AutoRunChannel = existing
        ? { ...existing, autoRunSummary: true, avatarUrl: stats.avatarUrl ?? existing.avatarUrl }
        : {
            id: `/@${stats.channel}`,
            name: stats.channel,
            avatarUrl: stats.avatarUrl ?? "",
            addedAt: new Date().toISOString(),
            autoRunSummary: true,
          };
      updated = [entry, ...current.filter((c) => c.name !== stats.channel)];
    } else {
      updated = current.filter((c) => c.name !== stats.channel);
    }
    await persistAutoRunChannels(updated);
    setAutoRunChannels(updated);
  }, []);

  const autoRunNames = new Set(autoRunChannels.map((c) => c.name));

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
      {/* Auto-run section */}
      <div className="section-header">
        <h1 className="section-title">Auto-run Channels</h1>
        <p className="section-desc">
          TL;DW automatically summarizes new videos from these channels when you open them.
          Toggle auto-run from any YouTube watch page, or from the history list below.
        </p>
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : autoRunChannels.length === 0 ? (
        <div className="empty-state">
          No channels tracked yet. Open a YouTube video and use the Auto-run toggle in the TL;DW panel to add one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
          {autoRunChannels.map((ch) => (
            <AutoRunCard
              key={ch.id}
              channel={ch}
              onRemove={(id) => void handleRemoveAutoRun(id)}
            />
          ))}
        </div>
      )}

      {/* Blocked summary channels section */}
      {!loading && blockedChannels.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 8 }}>
            <h1 className="section-title">Blocked — AI Summaries</h1>
            <p className="section-desc">
              TL;DW will never show an AI summary panel for videos from these channels.
              Click Unblock to restore it.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
            {blockedChannels.map((ch) => (
              <BlockedCard
                key={ch.id}
                channel={ch}
                onUnblock={(id) => void handleUnblock(id)}
              />
            ))}
          </div>
        </>
      )}

      {/* History section */}
      <div className="section-header" style={{ marginTop: autoRunChannels.length > 0 ? 8 : 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 className="section-title">Channel History</h1>
            <p className="section-desc">
              Channels you've watched with TL;DW. Expand a channel to see its video history and toggle auto-run.
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
          <>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
              {channels.length} {channels.length === 1 ? "channel" : "channels"} · {totalVideos} {totalVideos === 1 ? "video" : "videos"} total
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                <strong>You</strong> ratings
              </span>
              <TierBadge tier="basic" />
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
                <strong>AI</strong> &amp; <strong>Audience</strong>
              </span>
              <TierBadge tier="integrated" label="Direct API" />
            </div>
          </>
        )}
      </div>

      {!loading && channels.length === 0 ? (
        <div className="empty-state">
          No channel data yet. Watch some YouTube videos with TL;DW and your channel history will appear here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((ch) => (
            <ChannelCard
              key={ch.channel}
              stats={ch}
              isAutoRun={autoRunNames.has(ch.channel)}
              onToggleAutoRun={(stats, enable) => void handleToggleAutoRun(stats, enable)}
              trackMyAverage={trackMyAverage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
