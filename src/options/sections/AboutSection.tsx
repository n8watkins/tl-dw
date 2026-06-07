import { Icon } from "../components/Icons";

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
          <div className="card-title">
            <Icon name="send" />
            What it does
          </div>
          <div className="card-desc">
            Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> on any YouTube
            video — or use the popup or right-click menu — and TL;DW opens your
            AI of choice, fills in a saved prompt, and submits. You read the
            answer instead of watching. For AIs that can't watch a video, it
            attaches the transcript automatically.
          </div>
        </div>

        <div className="privacy-card">
          <div className="privacy-title">Privacy</div>
          <ul className="privacy-list">
            <li>No backend, accounts, analytics, or tracking.</li>
            <li>Saves the prompt you sent — never the response.</li>
            <li>Transcripts are sent, never stored in history.</li>
            <li>Old history auto-deletes (30 days, configurable).</li>
            <li>All data stays in local storage on your machine.</li>
            <li>No OAuth and no AI API key required.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Icon name="send" />
          Destinations
        </div>
        <div className="card-desc">
          <ul className="profiles-list-mini">
            <li><strong>Gemini</strong> — opens the video link; it watches the video itself.</li>
            <li><strong>ChatGPT / Claude / Perplexity</strong> — prompt auto-typed, transcript appended.</li>
            <li><strong>NotebookLM</strong> — adds the YouTube link as a source.</li>
          </ul>
          <p style={{ marginTop: 10 }}>
            Pick a default in Settings, override per-search from the popup. If a
            site's layout changes and auto-fill fails, the prompt is copied to
            your clipboard so a send is never silent.
          </p>
        </div>
      </div>

      <div className="about-grid">
        <div className="card">
          <div className="card-title">
            <Icon name="sparkles" />
            Features
          </div>
          <div className="card-desc">
            <ul className="profiles-list-mini">
              <li>One-keystroke send — shortcut, popup, or right-click.</li>
              <li>Transcript extraction for non-Gemini AIs.</li>
              <li>WATCH / SKIM / SKIP verdict for long videos.</li>
              <li>On-page key moments, click to seek.</li>
              <li>Auto-pause the video on send.</li>
              <li>Editable, reorderable, resettable profiles.</li>
              <li>Private local history — searchable and exportable.</li>
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="heart" />
            Built-in profiles
          </div>
          <div className="card-desc">
            <ul className="profiles-list-mini">
              <li><strong>TL;DW</strong> — core idea, takeaways, watch/skim/skip.</li>
              <li><strong>Research Mode</strong> — claims, evidence, what to verify.</li>
              <li><strong>Learning Mode</strong> — concepts and what to study next.</li>
              <li><strong>Tutorial Mode</strong> — steps, tradeoffs, next action.</li>
              <li><strong>Moment Finder</strong> — the strongest moments to watch.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Icon name="clock" />
          Roadmap
        </div>
        <div className="card-desc">
          <ul className="profiles-list-mini">
            <li>Key-moment markers on the YouTube scrubber</li>
            <li>Smarter, model-authored key moments (opt-in)</li>
            <li>Per-search curiosity field in the popup</li>
            <li>Profile import / export</li>
            <li>BYO-key API mode (optional response saving)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
