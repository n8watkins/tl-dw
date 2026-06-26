import { useEffect, useState } from "react";
import type { LifetimeStats, GeminiUsage, Tag, SearchHistoryEntry } from "../../types";
import { getLifetimeStats, getGeminiUsage, getHistory, getTags } from "../../lib/storage";
import { computeChannelStats, isSummaryEntry, type ChannelStats } from "../../lib/history";
import {
  CHANNEL_TAGS_KEY,
  DESTINATIONS,
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

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
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

// ---------------------------------------------------------------------------
// Year-long activity heatmap (GitHub-style contribution grid)
// ---------------------------------------------------------------------------
type HeatCell = { date: string; count: number };

/**
 * Build a 7×(52–53) grid (rows = day-of-week Sun..Sat, cols = week) from the
 * activity map, ending on the week that contains today. Mirrors the writer's
 * LOCAL date keys (localDateKey) so a real streak never reads as broken in a
 * negative-UTC zone. Cells past today are flagged future:true so they render
 * blank (GitHub does the same for the tail of the current week).
 */
function buildYearHeatmap(
  activity: Record<string, number>,
): { weeks: (HeatCell & { future: boolean })[][]; monthLabels: { col: number; label: string }[] } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = localDateKey(today);

  // End on Saturday of the current week so today's column is the last full one.
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay())); // forward to Saturday
  // Start 52 weeks before that Saturday's Sunday → 53 columns of 7 days.
  const start = new Date(end);
  start.setDate(start.getDate() - 6); // Sunday of the end week
  start.setDate(start.getDate() - 52 * 7); // 52 weeks earlier

  const weeks: (HeatCell & { future: boolean })[][] = [];
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;

  const cursor = new Date(start);
  for (let col = 0; col <= 52; col++) {
    const week: (HeatCell & { future: boolean })[] = [];
    for (let row = 0; row < 7; row++) {
      const key = localDateKey(cursor);
      const future = key > todayKey; // lexical compare is safe for YYYY-MM-DD
      week.push({ date: key, count: activity[key] ?? 0, future });

      // Label a column with a month name the first week that month appears in
      // its top (Sunday) row — matches GitHub's month-strip placement.
      if (row === 0) {
        const m = cursor.getMonth();
        if (m !== lastMonth) {
          monthLabels.push({ col, label: cursor.toLocaleString(undefined, { month: "short" }) });
          lastMonth = m;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return { weeks, monthLabels };
}

// GitHub-style accent ramp (uses the theme accent #a78bfa / primary #7c3aed).
const HEAT_RAMP = [
  "rgba(124,58,237,0.07)", // 0 — empty
  "rgba(124,58,237,0.30)", // 1
  "rgba(124,58,237,0.55)", // 2–3
  "rgba(124,58,237,0.78)", // 4–6
  "rgba(167,139,250,1)", // 7+
];

function heatLevel(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function heatmapColor(count: number): string {
  return HEAT_RAMP[heatLevel(count)]!;
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
// Usage distribution: count summaries grouped by some key → label, desc by count.
// ---------------------------------------------------------------------------
type Distribution = { key: string; label: string; count: number };

/** Top prompt profiles by summary count (profileName, falling back to profileId). */
function computeProfileUsage(summaries: SearchHistoryEntry[], limit: number): Distribution[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const e of summaries) {
    const key = e.profileId || e.profileName || "unknown";
    const label = e.profileName?.trim() || e.profileId || "Unknown profile";
    const prev = counts.get(key);
    counts.set(key, { label: prev?.label ?? label, count: (prev?.count ?? 0) + 1 });
  }
  return [...counts.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Destination usage by summary count; ids → DESTINATIONS labels, no id → Direct API. */
function computeDestinationUsage(summaries: SearchHistoryEntry[]): Distribution[] {
  const labelById = new Map(DESTINATIONS.map((d) => [d.id, d.label]));
  const DIRECT = "__direct__";
  const counts = new Map<string, number>();
  for (const e of summaries) {
    const key = e.destinationId || DIRECT;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === DIRECT ? "Direct API / other" : labelById.get(key) ?? key,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

/** A labelled proportion bar row, used by the profile + destination cards. */
function UsageBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const p = pct(count, total);
  return (
    <div style={{ padding: "7px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 11, color: "var(--faint)", flexShrink: 0 }}>
          {fmtCount(count)} · {p}%
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "rgba(148,163,184,0.12)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${p}%`, borderRadius: 999, background: color, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StatsSection() {
  const [stats, setStats] = useState<LifetimeStats | null>(null);
  const [usage, setUsage] = useState<GeminiUsage | null>(null);
  const [topChannels, setTopChannels] = useState<ChannelStats[]>([]);
  const [topTags, setTopTags] = useState<TagUsage[]>([]);
  const [topProfiles, setTopProfiles] = useState<Distribution[]>([]);
  const [destinations, setDestinations] = useState<Distribution[]>([]);

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
    setTopProfiles(computeProfileUsage(summaries, 6));
    setDestinations(computeDestinationUsage(summaries));
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
  const { weeks, monthLabels } = buildYearHeatmap(stats.activity);
  const yearTotal = weeks.reduce((sum, w) => sum + w.reduce((s, c) => s + (c.future ? 0 : c.count), 0), 0);
  const profileTotal = topProfiles.reduce((s, p) => s + p.count, 0);
  const destTotal = destinations.reduce((s, d) => s + d.count, 0);

  // Heatmap geometry: keep cell+gap in sync with the .stat-heatmap-cell CSS
  // (11px cell, 3px gap) so the month strip lines up with its column.
  const CELL = 11;
  const GAP = 3;
  const COL = CELL + GAP;

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

      {/* ── Year-long summary-activity heatmap (GitHub-style) ───── */}
      <div
        className="stat-card stat-card-heatmap"
        style={{ "--ca": "#7c3aed", "--cg": "rgba(124,58,237,0.14)", marginBottom: 12 } as React.CSSProperties}
      >
        <div className="stat-card-label">
          Summary activity
          {streak > 0 && <span className="stat-streak">🔥 {streak}-day streak</span>}
        </div>
        <div className="stat-card-sub" style={{ marginTop: 2 }}>
          {fmtCount(yearTotal)} {yearTotal === 1 ? "summary" : "summaries"} in the last year
        </div>

        {yearTotal === 0 ? (
          <div className="stat-empty">No summary activity yet — summarize a video to start your streak.</div>
        ) : (
          <div style={{ overflowX: "auto", paddingBottom: 4 }}>
            {/* Month strip — labels positioned over their first column */}
            <div style={{ position: "relative", height: 14, marginTop: 10, minWidth: weeks.length * COL }}>
              {monthLabels.map((m) => (
                <span
                  key={`${m.col}-${m.label}`}
                  style={{
                    position: "absolute",
                    left: m.col * COL,
                    fontSize: 10,
                    color: "var(--muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            {/* The grid: one column per week, 7 day-rows each */}
            <div className="stat-heatmap" style={{ minWidth: weeks.length * COL }}>
              {weeks.map((week, wi) => (
                <div key={wi} className="stat-heatmap-col">
                  {week.map((cell) => (
                    <div
                      key={cell.date}
                      className="stat-heatmap-cell"
                      style={{ background: cell.future ? "transparent" : heatmapColor(cell.count) }}
                      title={
                        cell.future
                          ? undefined
                          : `${cell.count} ${cell.count === 1 ? "summary" : "summaries"} on ${cell.date}`
                      }
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* GitHub-style "Less … More" legend */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 10, color: "var(--faint)" }}>
              <span>Less</span>
              {HEAT_RAMP.map((c, i) => (
                <span key={i} style={{ width: CELL, height: CELL, borderRadius: 2, background: c, display: "inline-block" }} />
              ))}
              <span>More</span>
            </div>
          </div>
        )}
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

      {/* ── Top profiles + destination usage ───────────────────── */}
      <div className="stats-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>

        <div className="stat-card" style={{ "--ca": "#8b5cf6", "--cg": "rgba(139,92,246,0.12)" } as React.CSSProperties}>
          <div className="stat-card-label">Prompt profiles you use most</div>
          {topProfiles.length === 0 ? (
            <div className="stat-empty">No summaries yet — your profile mix will appear here.</div>
          ) : (
            <div style={{ marginTop: 4 }}>
              {topProfiles.map((p) => (
                <UsageBar key={p.key} label={p.label} count={p.count} total={profileTotal} color="#a78bfa" />
              ))}
            </div>
          )}
        </div>

        <div className="stat-card" style={{ "--ca": "#06b6d4", "--cg": "rgba(6,182,212,0.12)" } as React.CSSProperties}>
          <div className="stat-card-label">Where you send summaries</div>
          {destinations.length === 0 ? (
            <div className="stat-empty">No summaries yet — your destination mix will appear here.</div>
          ) : (
            <div style={{ marginTop: 4 }}>
              {destinations.map((d) => (
                <UsageBar key={d.key} label={d.label} count={d.count} total={destTotal} color="#22d3ee" />
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
