import { Icon } from "../components/Icons";
import { DestinationIcon } from "../../lib/DestinationIcon";
import { DESTINATIONS } from "../../lib/constants";
import { shortcutKeys, useSummarizeShortcut } from "../../lib/useShortcut";

export function AboutSection() {
  const version = chrome.runtime.getManifest().version;
  const iconUrl = chrome.runtime.getURL("icons/tl-dw-128.png");
  const shortcut = useSummarizeShortcut();
  const keys = shortcut ? shortcutKeys(shortcut) : [];

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
          Summarize any YouTube video in one click.
        </h1>

        <p className="about-pitch">
          Press the TL;DW button under a YouTube video
          {keys.length > 0 && <> (or {keys.map((k, i) => <span key={i}>{i > 0 && "+"}<kbd>{k}</kbd></span>)})</>}.
          TL;DW reads the transcript and puts an AI summary right on the page: from the Gemini API
          with your own free key, or from Gemini in a background tab with no key at all. You can also
          send a video to ChatGPT, Claude or NotebookLM. Shape it with reusable profiles and tags,
          then decide what's worth your time.
        </p>
      </div>

      {/* ── Feature bento ────────────────────────────────────── */}
      <div className="about-bento">

        {/* Main — One-keystroke send (2-col × 2-row) */}
        <div className="about-card about-card-main" style={{"--ca": "#7c3aed", "--cg": "rgba(124,58,237,0.13)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(124,58,237,0.18)", color:"#a78bfa"}}>
            <Icon name="send" />
          </div>
          <div className="about-card-title">One click, or one keystroke</div>
          <div className="about-card-desc">
            Works on any YouTube video (not Shorts). Use the TL;DW button, the keyboard shortcut, the
            popup, or right-click to pick a specific profile.
          </div>
          {keys.length > 0 && (
            <div className="about-kbd-row">
              {keys.map((k, i) => (
                <span key={i} style={{ display: "contents" }}>
                  {i > 0 && <span className="about-kbd-plus">+</span>}
                  <kbd className="about-kbd">{k}</kbd>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Summary-activity stats */}
        <div className="about-card" style={{"--ca": "#22c55e", "--cg": "rgba(34,197,94,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(34,197,94,0.12)", color:"#4ade80"}}>
            <Icon name="bar-chart" />
          </div>
          <div className="about-card-title">Summary-activity stats</div>
          <div className="about-card-desc">
            See how much you summarize: total summaries, top-summarized channels, profile and destination usage, and a GitHub-style activity heatmap with a day streak.
          </div>
        </div>

        {/* On-page summary */}
        <div className="about-card" style={{"--ca": "#f97316", "--cg": "rgba(249,115,22,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(249,115,22,0.12)", color:"#fb923c"}}>
            <Icon name="eye" />
          </div>
          <div className="about-card-title">Summary on the page</div>
          <div className="about-card-desc">
            The summary lands right on the YouTube video — a one-line takeaway plus the key details, so you decide what's worth your time.
          </div>
        </div>

        {/* AI destinations — wide */}
        <div className="about-card about-card-wide" style={{"--ca": "#14b8a6", "--cg": "rgba(20,184,166,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(20,184,166,0.12)", color:"#2dd4bf"}}>
            <Icon name="sparkles" />
          </div>
          <div className="about-card-title">{DESTINATIONS.length} AI destinations</div>
          <div className="about-card-desc">
            Each destination handled the right way: Gemini, ChatGPT and Claude get the transcript when it
            fits their message box, a longer video goes to Gemini as a link it watches, and NotebookLM
            adds the link as a source.
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
          <div className="about-card-title">Profiles &amp; tags</div>
          <div className="about-card-desc">
            Reusable prompt templates — TL;DW, Research, Learning, Tutorial, or your own — plus tags that tweak the prompt for any channel or video.
          </div>
        </div>

        {/* History */}
        <div className="about-card" style={{"--ca": "#3b82f6", "--cg": "rgba(59,130,246,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(59,130,246,0.12)", color:"#60a5fa"}}>
            <Icon name="save" />
          </div>
          <div className="about-card-title">Summary history</div>
          <div className="about-card-desc">
            Every summary saved locally — video, profile, and prompt. Searchable, exportable, never shared.
          </div>
        </div>

        {/* Transcript */}
        <div className="about-card" style={{"--ca": "#06b6d4", "--cg": "rgba(6,182,212,0.1)"} as React.CSSProperties}>
          <div className="about-card-icon" style={{background:"rgba(6,182,212,0.12)", color:"#22d3ee"}}>
            <Icon name="download" />
          </div>
          <div className="about-card-title">Transcript extraction</div>
          <div className="about-card-desc">
            TL;DW reads the video's transcript and sends it with the prompt. With a Gemini key, videos
            without captions are watched by Gemini instead.
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
        No backend · no accounts · no tracking: your data stays in Chrome on this device.
        Works without a key (Gemini in a tab); add your own free Gemini key for summaries on the page.
      </div>
    </div>
  );
}
