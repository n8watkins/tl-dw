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
            <p style={{ marginBottom: 10 }}>
              TL;DW sends the YouTube video you're watching to the AI of your
              choice in one keystroke, using a saved prompt profile. You read the
              answer instead of watching the whole video.
            </p>
            <p style={{ marginBottom: 10 }}>
              Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> on any YouTube
              video — or use the popup or right-click menu. TL;DW opens the
              destination, fills in your prompt, and submits.
            </p>
            <p>
              For AIs that can't watch a video, it extracts the transcript and
              includes it automatically. Gemini opens the link directly.
            </p>
          </div>
        </div>

        <div className="privacy-card">
          <div className="privacy-title">Privacy</div>
          <ul className="privacy-list">
            <li>No backend, no servers, no accounts.</li>
            <li>No analytics or tracking of any kind.</li>
            <li>Saves the prompt you sent — never the AI's response.</li>
            <li>Transcripts are sent to your chosen AI, never stored in history.</li>
            <li>Old history auto-deletes (30 days by default; configurable).</li>
            <li>All data lives in Chrome's local storage on your machine.</li>
            <li>No YouTube/Google OAuth, and no AI API key required or used.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Icon name="send" />
          Destinations
        </div>
        <div className="card-desc">
          <p style={{ marginBottom: 10 }}>
            Pick a default in Settings, or override it per-search from the popup.
          </p>
          <ul className="profiles-list-mini">
            <li><strong>Gemini</strong> — opens the video link directly (it watches the video itself).</li>
            <li><strong>ChatGPT</strong> — prompt auto-typed, with the transcript appended.</li>
            <li><strong>Claude</strong> — prompt auto-typed, with the transcript appended.</li>
            <li><strong>Perplexity</strong> — prompt auto-typed, with the transcript appended.</li>
            <li><strong>NotebookLM</strong> — adds the YouTube link as a source to question yourself.</li>
          </ul>
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
            If a site changes its layout and auto-fill can't find the box, TL;DW
            copies the prompt to your clipboard and flags it in the popup, so a
            broken send is never silent.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Icon name="sparkles" />
          Features
        </div>
        <div className="card-desc">
          <ul className="profiles-list-mini">
            <li><strong>One-keystroke send</strong> — keyboard shortcut, popup, or YouTube right-click menu.</li>
            <li><strong>Transcript extraction</strong> — reads YouTube's own caption data for non-Gemini AIs.</li>
            <li><strong>Worth-watching verdict</strong> — long videos can lead with WATCH / SKIM / SKIP, with trusted-channel bypass.</li>
            <li><strong>Key moments on the video</strong> — an on-page panel of click-to-seek moments, built from the transcript.</li>
            <li><strong>Auto-pause</strong> — optionally pause the video the moment you send it.</li>
            <li><strong>Editable profiles</strong> — built-in templates you can tweak, duplicate, reorder, or reset.</li>
            <li><strong>Private local history</strong> — searchable, exportable, and auto-expiring.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Icon name="heart" />
          Built-in profiles
        </div>
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
        <div className="card-title">
          <Icon name="clock" />
          Roadmap
        </div>
        <div className="card-desc">
          <p style={{ marginBottom: 8 }}>Planned for future versions:</p>
          <ul className="profiles-list-mini">
            <li>Progress-bar markers for key moments (ticks on the YouTube scrubber)</li>
            <li>Smarter, model-authored key moments (opt-in)</li>
            <li>Custom curiosity field in the popup (per-search question)</li>
            <li>Profile import/export from the options page</li>
            <li>BYO-key API mode (optional, with opt-in response saving)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
