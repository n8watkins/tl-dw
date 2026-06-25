import { useEffect, useState, useCallback, useMemo } from "react";
import type { AutoRunChannel, SearchHistoryEntry, Tag } from "../../types";
import { getHistory, getAutoRunChannels, setAutoRunChannels as persistAutoRunChannels, getSettings, getTags } from "../../lib/storage";
import { CHANNEL_TAGS_KEY } from "../../lib/constants";
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
type TabKey = "all" | "auto";

/** Resolve the channel-tag map (channelName -> tagId[]) against the tag library
 *  into a name-keyed lookup of resolved Tag[]. The widget keys channel tags by
 *  display name (`channelTagKey`), which lines up directly with a
 *  ChannelStats.channel, so tag chips + tag search resolve for every channel. */
function resolveChannelTags(map: Record<string, string[]>, library: Tag[]): Map<string, Tag[]> {
  const byId = new Map(library.map((t) => [t.id, t]));
  const out = new Map<string, Tag[]>();
  for (const [key, ids] of Object.entries(map)) {
    const tags = ids.map((id) => byId.get(id)).filter((t): t is Tag => t !== undefined);
    if (tags.length) out.set(key, tags);
  }
  return out;
}

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

// ---- Tag chip (read-only, shown on channel cards / as filter pills) ---------

function TagChip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  const interactive = !!onClick;
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        border: "1px solid var(--border)",
        background: active ? "var(--accent, #1a73e8)" : "var(--surface)",
        color: active ? "#fff" : "var(--muted)",
        cursor: interactive ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {label}
    </span>
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
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
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
          color: "var(--muted)",
          cursor: "pointer",
        }}
      >
        Remove
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
          color: "var(--muted)",
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

function ChannelCard({
  stats,
  isAutoRun,
  onToggleAutoRun,
  trackMyAverage,
  tags,
}: {
  stats: ChannelStats;
  isAutoRun: boolean;
  onToggleAutoRun: (stats: ChannelStats, enable: boolean) => void;
  trackMyAverage: boolean;
  tags: Tag[];
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
            {/* Channel tags */}
            {tags.map((t) => (
              <TagChip key={t.id} label={t.label} />
            ))}
            {/* Last watched */}
            {stats.lastWatched && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
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
          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {stats.count} {stats.count === 1 ? "video" : "videos"}
          </span>
          <span
            style={{
              fontSize: 14,
              color: "var(--muted)",
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
                style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer", userSelect: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                Auto-summarize this channel
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Tab strip --------------------------------------------------------------

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--accent, #1a73e8)" : "2px solid transparent",
        color: active ? "var(--accent, #1a73e8)" : "var(--muted)",
        fontSize: 13,
        fontWeight: 600,
        padding: "8px 14px",
        cursor: "pointer",
        marginBottom: -1,
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      {label}
      {count > 0 && (
        <span style={{ marginLeft: 6, fontSize: 11, color: active ? "inherit" : "var(--faint)" }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ---- Main section -----------------------------------------------------------

export function ChannelsSection() {
  const [channels, setChannels] = useState<ChannelStats[]>([]);
  const [autoRunChannels, setAutoRunChannels] = useState<AutoRunChannel[]>([]);
  const [channelTags, setChannelTags] = useState<Map<string, Tag[]>>(new Map());
  const [totalVideos, setTotalVideos] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [loading, setLoading] = useState(true);
  const [trackMyAverage, setTrackMyAverage] = useState(true);

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");

  const reload = useCallback(async () => {
    const [history, autoRun, settings, library, tagMapRaw] = await Promise.all([
      getHistory(),
      getAutoRunChannels(),
      getSettings(),
      getTags(),
      chrome.storage.local.get(CHANNEL_TAGS_KEY),
    ]);
    const stats = computeChannelStats(history);
    const tagMap = (tagMapRaw[CHANNEL_TAGS_KEY] as Record<string, string[]>) ?? {};
    setChannels(stats);
    setAutoRunChannels(autoRun);
    setChannelTags(resolveChannelTags(tagMap, library));
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

  const autoRunNames = useMemo(
    () => new Set(autoRunChannels.map((c) => c.name)),
    [autoRunChannels],
  );

  const tagsFor = useCallback(
    (channelName: string): Tag[] => channelTags.get(channelName) ?? [],
    [channelTags],
  );

  // ---- All-channels tab: sort, then filter by search (name OR tag label) ----
  const sortedAll = useMemo(() => {
    return [...channels].sort((a, b) => {
      if (sortKey === "count") return b.count - a.count;
      if (sortKey === "rating") {
        const ra = a.avgAiRating ?? -Infinity;
        const rb = b.avgAiRating ?? -Infinity;
        return rb - ra;
      }
      // recent
      return new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime();
    });
  }, [channels, sortKey]);

  const q = search.trim().toLowerCase();
  const visibleAll = useMemo(() => {
    if (!q) return sortedAll;
    return sortedAll.filter((ch) => {
      if (ch.channel.toLowerCase().includes(q)) return true;
      const tags = tagsFor(ch.channel);
      return tags.some((t) => t.label.toLowerCase().includes(q));
    });
  }, [sortedAll, q, tagsFor]);

  const visibleAuto = useMemo(() => {
    if (!q) return autoRunChannels;
    return autoRunChannels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [autoRunChannels, q]);

  // Shared toolbar (search) — both tabs filter by name; All also filters tags.
  const searchToolbar = (
    <div className="history-toolbar" style={{ marginBottom: 16 }}>
      <input
        type="text"
        placeholder={activeTab === "all" ? "Search channels by name or tag…" : "Search auto-summarize channels…"}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>
  );

  return (
    <div>
      {/* Section header */}
      <div className="section-header">
        <h1 className="section-title">Channels</h1>
        <p className="section-desc">
          Channels you've watched with TL;DW, and the ones TL;DW auto-summarizes for you.
        </p>
      </div>

      {/* Tab strip */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          marginBottom: 20,
        }}
      >
        <TabButton
          label="All channels"
          count={channels.length}
          active={activeTab === "all"}
          onClick={() => { setActiveTab("all"); setSearch(""); }}
        />
        <TabButton
          label="Auto-summarize"
          count={autoRunChannels.length}
          active={activeTab === "auto"}
          onClick={() => { setActiveTab("auto"); setSearch(""); }}
        />
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : activeTab === "all" ? (
        /* ---- All channels tab ---- */
        <div>
          <p className="section-desc" style={{ marginBottom: 12 }}>
            Channels you've watched with TL;DW. Expand a channel to see its videos and turn on auto-summarize.
          </p>

          {channels.length > 0 && (
            <>
              {searchToolbar}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>
                  {visibleAll.length === channels.length
                    ? `${channels.length} ${channels.length === 1 ? "channel" : "channels"} · ${totalVideos} ${totalVideos === 1 ? "video" : "videos"} total`
                    : `${visibleAll.length} of ${channels.length} channels`}
                </p>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Sort:</span>
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
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  <strong>You</strong> ratings
                </span>
                <TierBadge tier="basic" />
                <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
                  <strong>AI</strong> &amp; <strong>Audience</strong>
                </span>
                <TierBadge tier="integrated" label="Direct API" />
              </div>
            </>
          )}

          {channels.length === 0 ? (
            <div className="empty-state">
              No channel data yet. Watch some YouTube videos with TL;DW and your channels will appear here.
            </div>
          ) : visibleAll.length === 0 ? (
            <div className="empty-state">
              No channels match “{search}”.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleAll.map((ch) => (
                <ChannelCard
                  key={ch.channel}
                  stats={ch}
                  isAutoRun={autoRunNames.has(ch.channel)}
                  onToggleAutoRun={(stats, enable) => void handleToggleAutoRun(stats, enable)}
                  trackMyAverage={trackMyAverage}
                  tags={tagsFor(ch.channel)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ---- Auto-summarize tab ---- */
        <div>
          <p className="section-desc" style={{ marginBottom: 12 }}>
            TL;DW automatically summarizes new videos from these channels when you open them.
            Turn auto-summarize on or off from any YouTube watch page, or from the All channels tab.
          </p>

          {autoRunChannels.length === 0 ? (
            <div className="empty-state">
              No auto-summarize channels yet. Turn on auto-summarize from any video's TL;DW panel,
              or from a channel in the All channels tab.
            </div>
          ) : (
            <>
              {autoRunChannels.length > 1 && searchToolbar}
              {visibleAuto.length === 0 ? (
                <div className="empty-state">
                  No auto-summarize channels match “{search}”.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {visibleAuto.map((ch) => (
                    <AutoRunCard
                      key={ch.id}
                      channel={ch}
                      onRemove={(id) => void handleRemoveAutoRun(id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
