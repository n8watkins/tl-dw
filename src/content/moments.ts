/**
 * Key-moment derivation + the on-YouTube panel (v1 of the seek-links feature).
 *
 * Moments are derived from the *timestamped transcript* alone — no model, no
 * reading of any AI answer — so this stays on the privacy-clean side of the
 * line: pick a handful of evenly-spread time windows, then label each with its
 * most salient sentence (highest summed word frequency, length-normalized).
 *
 * buildMomentsPanel returns a self-contained element; the caller (youtube.ts)
 * owns where it's inserted, how it's torn down, and what seeking actually does.
 */

export type TimedSegment = { startSeconds: number; text: string };
export type Moment = { startSeconds: number; label: string };

const STOPWORDS = new Set(
  ("the a an and or but if then of to in on at for with as is are was were be " +
    "been being this that these those it its they them their you your we our he " +
    "she his her not no do does did so just like really very much more most can " +
    "will would could should about into out over than them then there here what " +
    "when which who whom whose how why also too only even some any all each").split(
    " ",
  ),
);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (w) => w.length > 3 && !STOPWORDS.has(w),
  );
}

function tidy(sentence: string): string {
  let t = sentence.replace(/\s+/g, " ").trim();
  if (t.length > 90) t = t.slice(0, 88).replace(/\s+\S*$/, "") + "…";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** The most salient sentence in a window, used as its label. */
function bestSentence(
  bucket: TimedSegment[],
  freq: Map<string, number>,
): string {
  const text = bucket
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);
  const candidates = sentences.length ? sentences : [text];

  let best = candidates[0];
  let bestScore = -1;
  for (const sentence of candidates) {
    const ws = words(sentence);
    if (ws.length === 0) continue;
    let score = 0;
    for (const w of ws) score += freq.get(w) ?? 0;
    score /= Math.sqrt(ws.length); // don't just reward the longest sentence
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return tidy(best);
}

/**
 * Pick key moments from a timestamped transcript. Aims for one moment per ~3
 * minutes, clamped to 4–10, each anchored at the start of its time window.
 */
export function deriveMoments(
  segments: TimedSegment[],
  durationSeconds: number,
): Moment[] {
  const clean = segments.filter((s) => s.text && s.text.trim().length > 0);
  if (clean.length === 0) return [];

  const last = clean[clean.length - 1].startSeconds;
  const span = durationSeconds > 0 ? durationSeconds : last + 30;
  const target = Math.min(10, Math.max(4, Math.round(span / 180)));

  const freq = new Map<string, number>();
  for (const s of clean) {
    for (const w of words(s.text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  const windowSize = span / target;
  const buckets: TimedSegment[][] = Array.from({ length: target }, () => []);
  for (const s of clean) {
    let idx = Math.floor(s.startSeconds / windowSize);
    if (idx < 0) idx = 0;
    if (idx >= target) idx = target - 1;
    buckets[idx].push(s);
  }

  const moments: Moment[] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const label = bestSentence(bucket, freq);
    if (label) moments.push({ startSeconds: bucket[0].startSeconds, label });
  }
  return moments;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type Theme = {
  bg: string;
  border: string;
  text: string;
  sub: string;
  accent: string;
  hover: string;
};

function theme(): Theme {
  const dark = document.documentElement.hasAttribute("dark");
  return dark
    ? { bg: "#212121", border: "#3f3f3f", text: "#f1f1f1", sub: "#aaaaaa", accent: "#3ea6ff", hover: "#383838" }
    : { bg: "#ffffff", border: "#e5e5e5", text: "#0f0f0f", sub: "#606060", accent: "#065fd4", hover: "#f2f2f2" };
}

/** Build the moments panel element. The caller inserts and removes it. */
export function buildMomentsPanel(
  moments: Moment[],
  handlers: { onSeek: (seconds: number) => void; onClose: () => void },
): HTMLElement {
  const t = theme();
  const panel = document.createElement("div");
  panel.id = "tldw-moments";
  Object.assign(panel.style, {
    background: t.bg,
    border: `1px solid ${t.border}`,
    borderRadius: "12px",
    padding: "12px 14px",
    marginTop: "12px",
    marginBottom: "16px",
    font: "14px/1.4 Roboto, system-ui, sans-serif",
    color: t.text,
  });

  const head = document.createElement("div");
  Object.assign(head.style, {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: "8px",
  });

  const heading = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = "TL;DW — Key moments";
  Object.assign(title.style, { fontWeight: "600", fontSize: "15px" });
  const sub = document.createElement("div");
  sub.textContent = "Auto-detected from the transcript";
  Object.assign(sub.style, { color: t.sub, fontSize: "12px" });
  heading.append(title, sub);

  const close = document.createElement("button");
  close.textContent = "✕";
  close.setAttribute("aria-label", "Hide key moments");
  Object.assign(close.style, {
    background: "transparent",
    border: "none",
    color: t.sub,
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "1",
    padding: "4px",
  });
  close.addEventListener("click", handlers.onClose);

  head.append(heading, close);
  panel.append(head);

  for (const m of moments) {
    const row = document.createElement("button");
    Object.assign(row.style, {
      display: "flex",
      gap: "10px",
      alignItems: "flex-start",
      width: "100%",
      textAlign: "left",
      background: "transparent",
      border: "none",
      borderRadius: "8px",
      padding: "7px 8px",
      cursor: "pointer",
      color: t.text,
      font: "inherit",
    });
    row.addEventListener("mouseenter", () => (row.style.background = t.hover));
    row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
    row.addEventListener("click", () => handlers.onSeek(m.startSeconds));

    const time = document.createElement("span");
    time.textContent = formatTime(m.startSeconds);
    Object.assign(time.style, {
      color: t.accent,
      fontWeight: "600",
      flex: "0 0 auto",
      minWidth: "44px",
      fontVariantNumeric: "tabular-nums",
    });

    const label = document.createElement("span");
    label.textContent = m.label;
    label.style.flex = "1 1 auto";

    row.append(time, label);
    panel.append(row);
  }

  return panel;
}
