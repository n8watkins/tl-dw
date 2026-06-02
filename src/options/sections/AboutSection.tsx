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

      <div className="about-grid">
        <div className="card">
          <div className="card-title">What it does</div>
          <div className="card-desc">
            <p style={{ marginBottom: 10 }}>
              TL;DW is a Chrome extension that sends the current YouTube video to
              Gemini in one keystroke using a saved prompt profile.
            </p>
            <p>
              Press <kbd>Alt</kbd>+<kbd>G</kbd> on any YouTube video. TL;DW
              opens Gemini, fills in your prompt, and submits. You read the
              answer instead of watching the video.
            </p>
          </div>
        </div>

        <div className="privacy-card">
          <div className="privacy-title">Privacy</div>
          <ul className="privacy-list">
            <li>No backend. No servers. No accounts.</li>
            <li>No analytics or tracking of any kind.</li>
            <li>Saves prompts you sent — never Gemini's responses.</li>
            <li>All data lives in Chrome's local storage on your machine.</li>
            <li>No YouTube OAuth. No Google account access.</li>
            <li>No Gemini API key required or used.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Built-in profiles</div>
        <div className="card-desc">
          <ul className="profiles-list-mini mt-8">
            <li><strong>TL;DW</strong> — Core idea, key takeaways, watch/skim/skip verdict.</li>
            <li><strong>Research Mode</strong> — Claims, evidence, what needs fact-checking.</li>
            <li><strong>Learning Mode</strong> — Concepts, mental models, what to study next.</li>
            <li><strong>Tutorial Mode</strong> — Practical steps, tradeoffs, best next action.</li>
            <li><strong>Moment Finder</strong> — The 3–5 strongest moments worth watching.</li>
          </ul>
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
            All profiles are fully editable in the Profiles section. Edits to
            built-in profiles can be reset individually.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Roadmap</div>
        <div className="card-desc">
          <p style={{ marginBottom: 8 }}>Planned for future versions:</p>
          <ul className="profiles-list-mini">
            <li>Custom curiosity field in the popup (per-search question for Research/Learning/Tutorial)</li>
            <li>Profile import/export from the options page</li>
            <li>History dashboard with filter by profile and date range</li>
            <li>Transcript extraction for richer analysis</li>
            <li>Gemini API mode (BYO key, optional response saving)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
