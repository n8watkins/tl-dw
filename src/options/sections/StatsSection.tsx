import { useEffect, useState } from "react";
import type { LifetimeStats, GeminiUsage, Tag } from "../../types";
import { getLifetimeStats, getGeminiUsage, getHistory, getTags } from "../../lib/storage";
import { computeChannelStats, isSummaryEntry, type ChannelStats } from "../../lib/history";
import {
  CHANNEL_TAGS_KEY,
  GEMINI_USAGE_KEY,
  localDateKey,
  STORAGE_KEYS,
  TLDW_STATS_KEY,
  VIDEO_TAGS_KEY,
} from "../../lib/constants";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtCount(n: number): string {
  return n.toLocaleString();
}

function fmtHours(totalSeconds: number): string {
  const h = totalSeconds / 3600;
  if (h < 1) {
    const m = Math.round(totalSeconds / 60);
    return m < 1 ? "<1m" : `${m}m`;
  }
  return `${h.toFixed(1)}h`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Streak: consecutive days with ≥1 summary ending today or yesterday
// ---------------------------------------------------------------------------
function computeStreak(activity: Record<string, number>): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Use LOCAL date keys to match the writer (localDateKey): slicing the UTC ISO
  // string here would land on the wrong calendar day in negative-UTC zones and
  // read a real streak as broken.
  const todayStr = localDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = localDateKey(yesterday);

  if (!activity[todayStr] && !activity[yesterdayStr]) return 0;

  let streak = 0;
  const cursor = activity[todayStr] ? new Date(today) : new Date(yesterday);
  while (true) {
    const key = localDateKey(cursor);
    if (!activity[key]) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Channel avatar with a graceful fallback to a plain circle — YouTube's signed
 *  CDN avatar URLs expire (see STATUS.md), and a bare <img> would show a broken
 *  glyph. Falls back to the same .stat-channel-av placeholder on missing/expired. */
function ChannelAv({ url }: { url?: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) return <span className="stat-channel-av" />;
  return <img className="stat-channel-av" src={url} alt="" onError={() => setErr(true)} />;
}

// ---------------------------------------------------------------------------
// Most-used tags: tally how many channel/video assignments reference each tag,
// resolve ids → labels, return the top N.
// ---------------------------------------------------------------------------
type TagUsage = { id: string; label: string; count: number };

function computeTagUsage(
  library: Tag[],
  channelTags: Record<string, string[]>,
  videoTags: Record<string, string[]>,
  limit: number,
): TagUsage[] {
  const labelById = new Map(library.map((t) => [t.id, t.label]));
  const counts = new Map<string, number>();
  for (const ids of [...Object.values(channelTags), ...Object.values(videoTags)]) {
    for (const id of ids) {
      // Skip ids whose tag has been deleted from the library.
      if (!labelById.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: labelById.get(id)!, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StatsSection() {
  const [stats, setStats] = useState<LifetimeStats | null>(null);
  const [usage, setUsage] = useState<GeminiUsage | null>(null);
  const [topChannels, setTopChannels] = useState<ChannelStats[]>([]);
  const [topTags, setTopTags] = useState<TagUsage[]>([]);

  async function loadAll() {
    const [s, u, h, library, channelMapRaw, videoMapRaw] = await Promise.all([
      getLifetimeStats(),
      getGeminiUsage(),
      getHistory(),
      getTags(),
      chrome.storage.local.get(CHANNEL_TAGS_KEY),
      chrome.storage.local.get(VIDEO_TAGS_KEY),
    ]);
    const summaries = h.filter(isSummaryEntry);
    const channelTags = (channelMapRaw[CHANNEL_TAGS_KEY] as Record<string, string[]>) ?? {};
    const videoTags = (videoMapRaw[VIDEO_TAGS_KEY] as Record<string, string[]>) ?? {};

    setStats(s);
    setUsage(u);
    // computeChannelStats already returns count-desc; take the top few.
    setTopChannels(computeChannelStats(summaries).slice(0, 8));
    setTopTags(computeTagUsage(library, channelTags, videoTags, 8));
  }

  useEffect(() => {
    void loadAll();

    // Only reload for the keys this page renders, and debounce: history writes
    // can fire in bursts, and reloading everything on each is wasteful.
    const RELEVANT = new Set<string>([
      TLDW_STATS_KEY,
      GEMINI_USAGE_KEY,
      STORAGE_KEYS.history,
      CHANNEL_TAGS_KEY,
      VIDEO_TAGS_KEY,
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (!Object.keys(changes).some((k) => RELEVANT.has(k))) return;
      clearTimeout(timer);
      timer = setTimeout(() => void loadAll(), 300);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  if (!stats || !usage) {
    return (
      <div className="section-header">
        <div className="section-title">Your stats</div>
      </div>
    );
  }

  const streak = computeStreak(stats.activity);
  const hasAnyStats = stats.summaries > 0;

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Your stats</div>
        <div className="section-desc">
          Your summary activity. All counted locally — nothing leaves your browser.
        </div>
      </div>

      {/* ── Headline stats ─────────────────────────────────────── */}
      <div className="stats-grid stats-hero-row">

        <div className="stat-card" style={{ "--ca": "#7c3aed", "--cg": "rgba(124,58,237,0.25)" } as React.CSSProperties}>
          <div className="stat-card-label">Summaries created</div>
          <div className="stat-card-num" style={{ color: "#a78bfa" }}>{fmtCount(stats.summaries)}</div>
          <div className="stat-card-sub">
            {fmtHours(stats.durationSummarizedSeconds)} of content distilled
          </div>
        </div>

        <div className="stat-card" style={{ "--ca": "#eab308", "--cg": "rgba(234,179,8,0.22)" } as React.CSSProperties}>
          <div className="stat-card-label">Instant from cache</div>
          <div className="stat-card-num" style={{ color: "#fde047" }}>{fmtCount(stats.cacheHits)}</div>
          <div className="stat-card-sub">served instantly — zero API wait</div>
        </div>

        <div className="stat-card" style={{ "--ca": "#06b6d4", "--cg": "rgba(6,182,212,0.22)" } as React.CSSProperties}>
          <div className="stat-card-label">Summarized today</div>
          <div className="stat-card-num" style={{ color: "#22d3ee" }}>{fmtCount(usage.todayCalls)}</div>
          <div className="stat-card-sub">
            {streak > 0 ? `🔥 ${streak}-day streak` : "of ~500 free API calls/day"}
          </div>
        </div>
      </div>

      {/* ── Top channels + most-used tags ──────────────────────── */}
      <div className="stats-grid stats-mid-row">

        <div className="stat-card" style={{ "--ca": "#7c3aed", "--cg": "rgba(124,58,237,0.12)" } as React.CSSProperties}>
          <div className="stat-card-label">Channels you summarize most</div>
          {topChannels.length === 0 ? (
            <div className="stat-empty">No summaries yet — summarize a video to get started.</div>
          ) : (
            <div>
              {topChannels.map((c) => (
                <div key={c.channel} className="stat-channel-row">
                  <ChannelAv url={c.avatarUrl} />
                  <span className="stat-channel-name">{c.channel}</span>
                  <span className="stat-channel-meta">
                    {c.count} {c.count === 1 ? "summary" : "summaries"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="stat-card" style={{ "--ca": "#14b8a6", "--cg": "rgba(20,184,166,0.12)" } as React.CSSProperties}>
          <div className="stat-card-label">Most-used tags</div>
          {topTags.length === 0 ? (
            <div className="stat-empty">No tags yet — tag a channel or video to see them here.</div>
          ) : (
            <div>
              {topTags.map((t) => (
                <div key={t.id} className="stat-channel-row">
                  <span className="stat-channel-name">{t.label}</span>
                  <span className="stat-channel-meta">
                    {t.count} {t.count === 1 ? "assignment" : "assignments"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      {hasAnyStats && stats.since && (
        <div className="stats-since">
          Tracking since {fmtDate(stats.since)}
        </div>
      )}
    </div>
  );
}
