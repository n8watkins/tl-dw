import { useEffect, useState } from "react";
import type { LifetimeStats, GeminiUsage, SearchHistoryEntry } from "../../types";
import { getLifetimeStats, getGeminiUsage, getHistory } from "../../lib/storage";
import { computeChannelStats } from "../../lib/history";
import { GEMINI_USAGE_KEY, localDateKey, STORAGE_KEYS, TLDW_STATS_KEY } from "../../lib/constants";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format seconds → "Xh Ym" / "Ym" / "<1m" */
function fmtSeconds(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s <= 0) return "0m";
  const m = Math.floor(s / 60);
  if (m < 1) return "<1m";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

function fmtCount(n: number): string {
  return n.toLocaleString();
}

function fmtHours(totalSeconds: number): string {
  const h = totalSeconds / 3600;
  if (h < 1) return fmtSeconds(totalSeconds);
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

// ---------------------------------------------------------------------------
// Time saved from history: Σ max(0, duration - watched) for skim/skip entries
// ---------------------------------------------------------------------------
function computeTimeSaved(history: SearchHistoryEntry[]): number {
  return history.reduce((acc, e) => {
    if ((e.userRating === "skim" || e.userRating === "skip") && e.durationSeconds != null) {
      const watched = e.watchedSeconds ?? 0;
      return acc + Math.max(0, e.durationSeconds - watched);
    }
    return acc;
  }, 0);
}

// ---------------------------------------------------------------------------
// 12-week activity heatmap helpers
// ---------------------------------------------------------------------------

/** Build a 7×12 grid (rows=day-of-week, cols=week) from the activity map. */
function buildHeatmapGrid(activity: Record<string, number>): { date: string; count: number }[][] {
  // 84 days total (12 weeks), ending today.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Start from the beginning of the week (Sunday) 12 weeks ago.
  const startDay = new Date(today);
  startDay.setDate(startDay.getDate() - today.getDay()); // rewind to Sunday of current week
  startDay.setDate(startDay.getDate() - 11 * 7);         // 11 more weeks back = 12 weeks total

  const cols: { date: string; count: number }[][] = [];
  for (let col = 0; col < 12; col++) {
    const week: { date: string; count: number }[] = [];
    for (let row = 0; row < 7; row++) {
      const d = new Date(startDay);
      d.setDate(d.getDate() + col * 7 + row);
      const key = localDateKey(d); // match the writer's local-date keys
      week.push({ date: key, count: activity[key] ?? 0 });
    }
    cols.push(week);
  }
  return cols;
}

function heatmapColor(count: number): string {
  if (count === 0) return "rgba(124,58,237,0.07)";
  if (count === 1) return "rgba(124,58,237,0.28)";
  if (count <= 3) return "rgba(124,58,237,0.55)";
  return "rgba(124,58,237,0.9)";
}

// ---------------------------------------------------------------------------
// Donut chart (pure SVG)
// ---------------------------------------------------------------------------
type DonutSlice = { value: number; color: string; label: string };

function DonutChart({ slices, size = 120 }: { slices: DonutSlice[]; size?: number }) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) * 0.72;
  const stroke = r * 0.46;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = slices.map((slice) => {
    const pct = slice.value / total;
    const dashArray = `${pct * circumference} ${(1 - pct) * circumference}`;
    const dashOffset = -offset * circumference;
    offset += pct;
    return { ...slice, dashArray, dashOffset, pct };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
      {arcs.map((arc, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={arc.color}
          strokeWidth={stroke}
          strokeDasharray={arc.dashArray}
          strokeDashoffset={arc.dashOffset}
          strokeLinecap="round"
          style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
        />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#f1f5f9" fontSize="18" fontWeight="800">
        {fmtCount(total)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#94a3b8" fontSize="9">
        videos
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StatsSection() {
  const [stats, setStats] = useState<LifetimeStats | null>(null);
  const [usage, setUsage] = useState<GeminiUsage | null>(null);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  async function loadAll() {
    const [s, u, h] = await Promise.all([getLifetimeStats(), getGeminiUsage(), getHistory()]);
    setStats(s);
    setUsage(u);
    setHistory(h);
  }

  useEffect(() => {
    void loadAll();

    // Only reload for the keys this page renders, and debounce: watch-time fires
    // frequent storage writes, and reloading everything (3 storage reads +
    // channel-stat recompute) on each is wasteful.
    const RELEVANT = new Set<string>([TLDW_STATS_KEY, GEMINI_USAGE_KEY, STORAGE_KEYS.history]);
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

  // Derived values
  const channelStats = computeChannelStats(history);
  const topChannel = channelStats[0];
  const uniqueChannels = channelStats.length;
  const timeSavedSeconds = computeTimeSaved(history);
  const streak = computeStreak(stats.activity);
  const heatmapGrid = buildHeatmapGrid(stats.activity);

  const donutSlices: DonutSlice[] = [
    { value: stats.engaged, color: "#22c55e", label: "Engaged" },
    { value: stats.skimmed, color: "#eab308", label: "Skimmed" },
    { value: stats.skipped, color: "#ef4444", label: "Skipped" },
  ];
  const donutTotal = stats.engaged + stats.skimmed + stats.skipped;

  const hasAnyStats = stats.summaries > 0 || donutTotal > 0;

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Your stats</div>
        <div className="section-desc">
          What TL;DW has saved you. All counted locally — nothing leaves your browser.
        </div>
      </div>

      {/* ── Hero row ───────────────────────────────────────────── */}
      <div className="stats-grid stats-hero-row">

        <div className="stat-card" style={{ "--ca": "#7c3aed", "--cg": "rgba(124,58,237,0.25)" } as React.CSSProperties}>
          <div className="stat-card-label">Videos summarized</div>
          <div className="stat-card-num" style={{ color: "#a78bfa" }}>{fmtCount(stats.summaries)}</div>
          <div className="stat-card-sub">
            {stats.cacheHits > 0 && <>{fmtCount(stats.cacheHits)} instant from cache</>}
          </div>
        </div>

        <div className="stat-card" style={{ "--ca": "#14b8a6", "--cg": "rgba(20,184,166,0.22)" } as React.CSSProperties}>
          <div className="stat-card-label">Time saved</div>
          <div className="stat-card-num" style={{ color: "#2dd4bf" }}>{fmtSeconds(timeSavedSeconds)}</div>
          <div className="stat-card-sub">from videos you skipped or skimmed</div>
        </div>

        <div className="stat-card" style={{ "--ca": "#f97316", "--cg": "rgba(249,115,22,0.22)" } as React.CSSProperties}>
          <div className="stat-card-label">Sponsor time skipped</div>
          <div className="stat-card-num" style={{ color: "#fb923c" }}>{fmtSeconds(stats.sponsorSecondsSaved)}</div>
          <div className="stat-card-sub">
            across {fmtCount(stats.sponsorSkips)} {stats.sponsorSkips === 1 ? "skip" : "skips"}
          </div>
        </div>
      </div>

      {/* ── Middle row: donut + heatmap ────────────────────────── */}
      <div className="stats-grid stats-mid-row">

        {/* Engagement donut */}
        <div className="stat-card stat-card-donut" style={{ "--ca": "#8b5cf6", "--cg": "rgba(139,92,246,0.15)" } as React.CSSProperties}>
          <div className="stat-card-label">Engagement breakdown</div>
          {donutTotal === 0 ? (
            <div className="stat-empty">Watch some videos — TL;DW rates them automatically</div>
          ) : (
            <div className="stat-donut-body">
              <DonutChart slices={donutSlices} size={130} />
              <div className="stat-donut-legend">
                {donutSlices.map((s) => {
                  const pct = donutTotal > 0 ? Math.round((s.value / donutTotal) * 100) : 0;
                  return (
                    <div key={s.label} className="stat-legend-row">
                      <span className="stat-legend-dot" style={{ background: s.color }} />
                      <span className="stat-legend-label">{s.label}</span>
                      <span className="stat-legend-count">{fmtCount(s.value)}</span>
                      <span className="stat-legend-pct">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Activity heatmap */}
        <div className="stat-card stat-card-heatmap" style={{ "--ca": "#7c3aed", "--cg": "rgba(124,58,237,0.12)" } as React.CSSProperties}>
          <div className="stat-card-label">
            Activity
            {streak > 0 && (
              <span className="stat-streak">🔥 {streak}-day streak</span>
            )}
          </div>
          <div className="stat-heatmap">
            {heatmapGrid.map((week, wi) => (
              <div key={wi} className="stat-heatmap-col">
                {week.map((day) => (
                  <div
                    key={day.date}
                    className="stat-heatmap-cell"
                    title={day.count > 0 ? `${day.date}: ${day.count} summar${day.count === 1 ? "y" : "ies"}` : day.date}
                    style={{ background: heatmapColor(day.count) }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Small tile row ──────────────────────────────────────── */}
      <div className="stats-grid stats-small-row">

        <div className="stat-card stat-card-sm" style={{ "--ca": "#eab308", "--cg": "rgba(234,179,8,0.15)" } as React.CSSProperties}>
          <div className="stat-sm-icon">⚡</div>
          <div className="stat-sm-num" style={{ color: "#fde047" }}>{fmtCount(stats.cacheHits)}</div>
          <div className="stat-sm-label">Instant summaries</div>
          <div className="stat-sm-sub">served from cache — zero wait</div>
        </div>

        <div className="stat-card stat-card-sm" style={{ "--ca": "#22c55e", "--cg": "rgba(34,197,94,0.15)" } as React.CSSProperties}>
          <div className="stat-sm-icon">📺</div>
          <div className="stat-sm-num" style={{ color: "#4ade80" }}>{fmtHours(stats.durationSummarizedSeconds)}</div>
          <div className="stat-sm-label">Hours previewed</div>
          <div className="stat-sm-sub">of content summarized</div>
        </div>

        <div className="stat-card stat-card-sm" style={{ "--ca": "#f43f5e", "--cg": "rgba(244,63,94,0.15)" } as React.CSSProperties}>
          <div className="stat-sm-icon">🎯</div>
          <div className="stat-sm-num" style={{ color: "#fb7185", fontSize: topChannel ? "15px" : undefined }}>
            {topChannel ? topChannel.channel : "—"}
          </div>
          <div className="stat-sm-label">Top channel</div>
          <div className="stat-sm-sub">
            {topChannel ? `${fmtCount(topChannel.count)} videos` : "no data yet"}
          </div>
        </div>

        <div className="stat-card stat-card-sm" style={{ "--ca": "#06b6d4", "--cg": "rgba(6,182,212,0.15)" } as React.CSSProperties}>
          <div className="stat-sm-icon">📡</div>
          <div className="stat-sm-num" style={{ color: "#22d3ee" }}>{fmtCount(uniqueChannels)}</div>
          <div className="stat-sm-label">Channels explored</div>
          <div className="stat-sm-sub">in your history</div>
        </div>

        <div className="stat-card stat-card-sm" style={{ "--ca": "#a78bfa", "--cg": "rgba(167,139,250,0.15)" } as React.CSSProperties}>
          <div className="stat-sm-icon">🔮</div>
          <div className="stat-sm-num" style={{ color: "#c4b5fd" }}>{fmtCount(usage.todayCalls)}</div>
          <div className="stat-sm-label">API calls today</div>
          <div className="stat-sm-sub">of ~500 free</div>
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
