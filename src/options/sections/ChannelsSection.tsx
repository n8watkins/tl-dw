import { useEffect, useState, useCallback, useMemo } from "react";
import type { AutoRunChannel, PromptProfile, SearchHistoryEntry } from "../../types";
import {
  getAutoRunChannels,
  getChannelLabels,
  getChannelProfiles,
  getHistory,
  getProfiles,
  getSettings,
  setAutoRunChannels as persistAutoRunChannels,
  setChannelProfile,
} from "../../lib/storage";
import { computeChannelStats, isSummaryEntry, type ChannelStats } from "../../lib/history";
import { VirtualList } from "../components/VirtualList";

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

type SortKey = "count" | "recent";
type TabKey = "all" | "auto";

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

// ---- Label chip (read-only: the tags of TL;DW before 1.4) -------------------

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
        // White on --primary (#7c3aed) is 5.7:1; on --accent it was 2.7:1.
        background: active ? "var(--primary)" : "var(--surface)",
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

function VideoRow({ entry }: { entry: SearchHistoryEntry }) {
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
  labels,
  styleId,
  profiles,
  defaultName,
  onChangeStyle,
}: {
  stats: ChannelStats;
  isAutoRun: boolean;
  onToggleAutoRun: (stats: ChannelStats, enable: boolean) => void;
  labels: string[];
  /** The channel's default style, if it has one. */
  styleId?: string;
  profiles: PromptProfile[];
  /** The name of the user's default style, for the "Your default" choice. */
  defaultName: string;
  onChangeStyle: (channel: string, profileId: string | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const styleName = profiles.find((p) => p.id === styleId)?.name;
  const styleSelectId = `channel-style-${stats.channel}`;

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
            {/* The channel's style, when it has its own */}
            {styleName && <TagChip label={styleName} active />}
            {/* Labels (the tags of TL;DW before 1.4) */}
            {labels.map((label) => (
              <TagChip key={label} label={label} />
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
            {stats.count} {stats.count === 1 ? "summary" : "summaries"}
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
            {/* Render the video rows only while open (the accordion otherwise
                mounts EVERY channel's full list even when collapsed) and window
                them, so a channel with hundreds of watched videos under
                "unlimited" history stays cheap. Bounded height keeps the outer
                channel-list measurement stable. */}
            {expanded && (
              <VirtualList
                items={stats.videos}
                getKey={(v) => v.id}
                estimateSize={40}
                gap={0}
                style={{ maxHeight: 320 }}
                renderItem={(v) => <VideoRow entry={v} />}
              />
            )}
            {/* The channel's default style */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 10, marginTop: 4, flexWrap: "wrap" }}>
              <label htmlFor={styleSelectId} style={{ fontSize: 12, color: "var(--muted)" }}>
                Summarize this channel as
              </label>
              <select
                id={styleSelectId}
                className="setting-select"
                style={{ fontSize: 12 }}
                value={styleId ?? ""}
                onChange={(e) => onChangeStyle(stats.channel, e.target.value || undefined)}
              >
                <option value="">Your default ({defaultName})</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
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
  const [channelLabels, setChannelLabels] = useState<Map<string, string[]>>(new Map());
  const [channelStyles, setChannelStyles] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<PromptProfile[]>([]);
  const [defaultName, setDefaultName] = useState("");
  const [totalVideos, setTotalVideos] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");

  const reload = useCallback(async () => {
    const [history, autoRun, labels, styles, profileList, settings] = await Promise.all([
      getHistory(),
      getAutoRunChannels(),
      getChannelLabels(),
      getChannelProfiles(),
      getProfiles(),
      getSettings(),
    ]);
    const summaries = history.filter(isSummaryEntry);
    const stats = computeChannelStats(summaries);
    setChannels(stats);
    setAutoRunChannels(autoRun);
    setChannelLabels(labels);
    setChannelStyles(styles);
    setProfiles(profileList);
    setDefaultName((profileList.find((p) => p.id === settings.defaultProfileId) ?? profileList[0])?.name ?? "");
    setTotalVideos(summaries.filter((e) => !!e.channel).length);
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

  const labelsFor = useCallback(
    (channelName: string): string[] => channelLabels.get(channelName) ?? [],
    [channelLabels],
  );
  const styleNameFor = useCallback(
    (channelName: string): string | undefined => profiles.find((p) => p.id === channelStyles[channelName])?.name,
    [profiles, channelStyles],
  );

  const handleChangeStyle = useCallback(async (channel: string, profileId: string | undefined) => {
    await setChannelProfile(channel, profileId);
    setChannelStyles(await getChannelProfiles());
  }, []);

  // ---- All-channels tab: sort, then filter by search (name, label or style) ----
  const sortedAll = useMemo(() => {
    return [...channels].sort((a, b) => {
      if (sortKey === "count") return b.count - a.count;
      // recent
      return new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime();
    });
  }, [channels, sortKey]);

  const q = search.trim().toLowerCase();
  const visibleAll = useMemo(() => {
    if (!q) return sortedAll;
    return sortedAll.filter((ch) => {
      if (ch.channel.toLowerCase().includes(q)) return true;
      if (styleNameFor(ch.channel)?.toLowerCase().includes(q)) return true;
      return labelsFor(ch.channel).some((label) => label.toLowerCase().includes(q));
    });
  }, [sortedAll, q, labelsFor, styleNameFor]);

  const visibleAuto = useMemo(() => {
    if (!q) return autoRunChannels;
    return autoRunChannels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [autoRunChannels, q]);

  // Shared toolbar (search) — both tabs filter by name; All also by label and style.
  const searchToolbar = (
    <div className="history-toolbar" style={{ marginBottom: 16 }}>
      <input
        type="text"
        aria-label={activeTab === "all" ? "Search channels by name, label or style" : "Search auto-summarize channels"}
        placeholder={activeTab === "all" ? "Search channels by name, label or style…" : "Search auto-summarize channels…"}
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
          Channels you've summarized with TL;DW, and the ones TL;DW auto-summarizes for you.
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
            Channels you've summarized with TL;DW. Expand a channel to see its videos, pick the style its
            videos are summarized in (a cooking channel as Tutorial, a lecture channel as Learning), and
            turn on auto-summarize.
          </p>

          {channels.length > 0 && (
            <>
              {searchToolbar}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>
                  {visibleAll.length === channels.length
                    ? `${channels.length} ${channels.length === 1 ? "channel" : "channels"} · ${totalVideos} ${totalVideos === 1 ? "summary" : "summaries"} total`
                    : `${visibleAll.length} of ${channels.length} channels`}
                </p>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Sort:</span>
                  <select
                    className="setting-select"
                    aria-label="Sort channels"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    style={{ fontSize: 12 }}
                  >
                    <option value="count">Most summarized</option>
                    <option value="recent">Recent</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {channels.length === 0 ? (
            <div className="empty-state">
              No channel data yet. Summarize some YouTube videos with TL;DW and your channels will appear here.
            </div>
          ) : visibleAll.length === 0 ? (
            <div className="empty-state">
              No channels match “{search}”.
            </div>
          ) : (
            <VirtualList
              items={visibleAll}
              getKey={(ch) => ch.channel}
              estimateSize={72}
              style={{ maxHeight: "calc(100vh - 280px)" }}
              renderItem={(ch) => (
                <ChannelCard
                  stats={ch}
                  isAutoRun={autoRunNames.has(ch.channel)}
                  onToggleAutoRun={(stats, enable) => void handleToggleAutoRun(stats, enable)}
                  labels={labelsFor(ch.channel)}
                  styleId={channelStyles[ch.channel]}
                  profiles={profiles}
                  defaultName={defaultName}
                  onChangeStyle={(channel, id) => void handleChangeStyle(channel, id)}
                />
              )}
            />
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
                <VirtualList
                  items={visibleAuto}
                  getKey={(ch) => ch.id}
                  estimateSize={64}
                  style={{ maxHeight: "calc(100vh - 280px)" }}
                  renderItem={(ch) => (
                    <AutoRunCard
                      channel={ch}
                      onRemove={(id) => void handleRemoveAutoRun(id)}
                    />
                  )}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
