import { Icon } from "../components/Icons";
import { DestinationIcon } from "../../lib/DestinationIcon";
import { DESTINATIONS } from "../../lib/constants";

export function AboutSection() {
  const version = chrome.runtime.getManifest().version;
  const iconUrl = chrome.runtime.getURL("icons/tl-dw-128.png");

  return (
    <div className="about-page">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="about-hero">
        <div className="about-hero-brand">
          <img className="about-icon" src={iconUrl} alt="" />
          <div>
            <div className="about-logo">TL;DW</div>
            <div className="about-tagline">Too Long; Didn't Watch</div>
          </div>
          <span className="about-version">v{version}</span>
        </div>

        <h1 className="about-headline">
          Stop watching to find out if it's worth watching.
        </h1>

        <p className="about-pitch">
          Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> on any YouTube video. TL;DW opens
          your AI — Gemini, ChatGPT, Claude, or NotebookLM — with the full transcript
          attached and the prompt already submitted. Read the summary. Decide what's worth your time.
        </p>
      </div>

      {/* ── Feature bento ────────────────────────────────────── */}
      <div className="about-bento">

        {/* Main — One-keystroke send (2-col × 2-row) */}
        <div className="about-card about-card-main" style={{"--ca": "#7c3aed", "--cg": "rgba(124,58,237,0.13)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(124,58,237,0.18)", color:"#a78bfa"}}>
            <Icon name="send" />
          </div>
          <div className="about-card-title">One-keystroke send</div>
          <div className="about-card-desc">
            Works on any YouTube video or Short. Use the keyboard shortcut, the popup, or right-click to pick a specific profile.
          </div>
          <div className="about-kbd-row">
            <kbd className="about-kbd">Alt</kbd>
            <span className="about-kbd-plus">+</span>
            <kbd className="about-kbd">Shift</kbd>
            <span className="about-kbd-plus">+</span>
            <kbd className="about-kbd">G</kbd>
          </div>
        </div>

        {/* Engagement tracking */}
        <div className="about-card" style={{"--ca": "#22c55e", "--cg": "rgba(34,197,94,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(34,197,94,0.12)", color:"#4ade80"}}>
            <Icon name="clock" />
          </div>
          <div className="about-card-title">Engagement tracking</div>
          <div className="about-card-desc">
            TL;DW measures how much of each video you actually watch and auto-rates it Engaged, Skimmed, or Skipped — building per-channel insights over time.
          </div>
        </div>

        {/* WATCH / SKIM / SKIP */}
        <div className="about-card" style={{"--ca": "#f97316", "--cg": "rgba(249,115,22,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(249,115,22,0.12)", color:"#fb923c"}}>
            <Icon name="eye" />
          </div>
          <div className="about-card-title">WATCH / SKIM / SKIP</div>
          <div className="about-card-desc">
            Long videos get an upfront verdict. Know if it's worth your time before reading a word.
          </div>
        </div>

        {/* 5 AI destinations — wide */}
        <div className="about-card about-card-wide" style={{"--ca": "#14b8a6", "--cg": "rgba(20,184,166,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(20,184,166,0.12)", color:"#2dd4bf"}}>
            <Icon name="sparkles" />
          </div>
          <div className="about-card-title">5 AI destinations</div>
          <div className="about-card-desc">
            Each destination handled the right way — Gemini watches the video directly; others get the full extracted transcript.
          </div>
          <div className="about-dest-row">
            {DESTINATIONS.map((d) => (
              <div key={d.id} className="about-dest-chip">
                <DestinationIcon id={d.id} size={20} />
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Profiles */}
        <div className="about-card" style={{"--ca": "#8b5cf6", "--cg": "rgba(139,92,246,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(139,92,246,0.15)", color:"#c4b5fd"}}>
            <Icon name="duplicate" />
          </div>
          <div className="about-card-title">Prompt profiles</div>
          <div className="about-card-desc">
            Reusable, fully editable templates. TL;DW, Research, Learning, Tutorial — or build your own.
          </div>
        </div>

        {/* History */}
        <div className="about-card" style={{"--ca": "#3b82f6", "--cg": "rgba(59,130,246,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(59,130,246,0.12)", color:"#60a5fa"}}>
            <Icon name="save" />
          </div>
          <div className="about-card-title">Search history</div>
          <div className="about-card-desc">
            Every search saved locally — video, profile, and prompt. Searchable, exportable, never shared.
          </div>
        </div>

        {/* Transcript */}
        <div className="about-card" style={{"--ca": "#06b6d4", "--cg": "rgba(6,182,212,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(6,182,212,0.12)", color:"#22d3ee"}}>
            <Icon name="download" />
          </div>
          <div className="about-card-title">Transcript extraction</div>
          <div className="about-card-desc">
            For AIs that can't watch, TL;DW pulls the full transcript and attaches it automatically.
          </div>
        </div>

        {/* Auto-pause */}
        <div className="about-card" style={{"--ca": "#ef4444", "--cg": "rgba(239,68,68,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(239,68,68,0.12)", color:"#f87171"}}>
            <Icon name="sliders" />
          </div>
          <div className="about-card-title">Auto-pause & submit</div>
          <div className="about-card-desc">
            The video pauses the moment you send, and the prompt submits automatically.
          </div>
        </div>

      </div>

      {/* ── Privacy footer ───────────────────────────────────── */}
      <div className="about-privacy-note">
        No backend · no accounts · no tracking — everything stays in Chrome's local storage.
        No AI API key required.
      </div>
    </div>
  );
}
