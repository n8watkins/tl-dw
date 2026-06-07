import { Icon } from "../components/Icons";
import type { IconProps } from "../components/Icons";

type Feature = {
  icon: IconProps["name"];
  bg: string;
  color: string;
  title: string;
  desc: string;
};

const FEATURES: Feature[] = [
  {
    icon: "send",
    bg: "rgba(124,58,237,0.15)", color: "#a78bfa",
    title: "One-keystroke send",
    desc: "Press Alt+Shift+G on any YouTube video or Short. Or use the popup or right-click menu to pick a specific profile.",
  },
  {
    icon: "sparkles",
    bg: "rgba(20,184,166,0.12)", color: "#2dd4bf",
    title: "5 AI destinations",
    desc: "Gemini, ChatGPT, Claude, NotebookLM, and Perplexity — each handled the right way for that service.",
  },
  {
    icon: "download",
    bg: "rgba(59,130,246,0.12)", color: "#60a5fa",
    title: "Transcript extraction",
    desc: "For AIs that can't watch video, TL;DW pulls the full transcript and attaches it — no copy-paste needed.",
  },
  {
    icon: "eye",
    bg: "rgba(249,115,22,0.12)", color: "#fb923c",
    title: "WATCH / SKIM / SKIP",
    desc: "Long videos get an upfront verdict so you know whether it's worth your time before reading the summary.",
  },
  {
    icon: "clock",
    bg: "rgba(34,197,94,0.12)", color: "#4ade80",
    title: "Key moments",
    desc: "Clickable timestamps auto-detected from the transcript appear right on the YouTube page. Click any to seek.",
  },
  {
    icon: "duplicate",
    bg: "rgba(167,139,250,0.15)", color: "#c4b5fd",
    title: "Prompt profiles",
    desc: "Reusable, fully editable templates — TL;DW, Research, Learning, Tutorial. Customize any or build your own.",
  },
  {
    icon: "save",
    bg: "rgba(59,130,246,0.12)", color: "#93c5fd",
    title: "Search history",
    desc: "Every search saved locally with the video, profile, and prompt. Searchable, exportable, never shared.",
  },
  {
    icon: "sliders",
    bg: "rgba(239,68,68,0.12)", color: "#f87171",
    title: "Auto-pause & auto-submit",
    desc: "The video pauses when you send and the prompt submits automatically — so nothing interrupts your flow.",
  },
];

export function AboutSection() {
  const version = chrome.runtime.getManifest().version;
  const iconUrl = chrome.runtime.getURL("icons/tl-dw-128.png");

  return (
    <div>
      <div className="about-hero">
        <img className="about-icon" src={iconUrl} alt="" />
        <div>
          <div className="about-logo">TL;DW</div>
          <div className="about-tagline">Too Long; Didn't Watch</div>
        </div>
        <span className="about-version">v{version}</span>
      </div>

      <div className="about-features">
        {FEATURES.map(({ icon, bg, color, title, desc }) => (
          <div key={title} className="about-feature">
            <div className="about-feature-icon" style={{ background: bg, color }}>
              <Icon name={icon} />
            </div>
            <div className="about-feature-title">{title}</div>
            <div className="about-feature-desc">{desc}</div>
          </div>
        ))}
      </div>

      <div className="about-privacy-note">
        No backend, no accounts, no tracking — everything stays in Chrome's local storage.
        No AI API key required.
      </div>
    </div>
  );
}
