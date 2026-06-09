import { Icon } from "../components/Icons";

function StepYouTubeIcon() {
  return (
    <svg width={34} height={24} viewBox="0 0 34 24" aria-hidden="true">
      <rect width="34" height="24" rx="5" fill="currentColor" />
      <polygon points="13,6 13,18 24.5,12" fill="white" />
    </svg>
  );
}

export function SetupSection() {
  function openShortcuts() {
    void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  function goToDirectApi() {
    window.location.hash = "directapi";
  }

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Watch what you want to watch.</h1>
        <p className="section-desc">
          TL;DW summarizes any YouTube video in seconds — so you decide if it's worth your time before you spend it.
        </p>
      </div>

      <div className="steps">
        <div className="step">
          <div className="step-icon step-icon-red">
            <StepYouTubeIcon />
          </div>
          <div className="step-num">Step 1</div>
          <div className="step-title">Open YouTube</div>
          <div className="step-body">
            Navigate to any video or Short. TL;DW detects it automatically — no extra clicking.
          </div>
        </div>
        <div className="step">
          <div className="step-icon step-icon-purple">
            <Icon name="sparkles" />
          </div>
          <div className="step-num">Step 2</div>
          <div className="step-title">Summarize to your AI</div>
          <div className="step-body">
            Press <kbd>Alt+Shift+G</kbd>. Gemini, ChatGPT, or Claude opens with the full analysis already running.
          </div>
        </div>
        <div className="step">
          <div className="step-icon step-icon-teal">
            <Icon name="eye" />
          </div>
          <div className="step-num">Step 3</div>
          <div className="step-title">Watch what you want</div>
          <div className="step-body">
            Read the summary, catch the key moments, skip what doesn't matter. Your time, your call.
          </div>
        </div>
      </div>

      <hr className="divider" />

      <div className="section-header">
        <h2 className="section-title" style={{ fontSize: 18 }}>Two ways to summarize</h2>
        <p className="section-desc">
          TL;DW can hand a video to AI in two ways. Pick one — or use both.
        </p>
      </div>

      <div className="mode-grid">
        <div className="card mode-card">
          <div className="mode-card-title">
            <Icon name="sparkles" /> Open in a tab
          </div>
          <div className="mode-card-tag">No API key · uses your AI subscription</div>
          <div className="card-desc">
            TL;DW opens your chosen AI (Gemini, ChatGPT, Claude, Perplexity, NotebookLM) with
            the prompt already typed and running. You can keep that tab in the
            background — TL;DW reads the finished answer back out of it and drops the summary
            onto the YouTube page for you. Nothing to set up; it just uses wherever you're
            already signed in.
          </div>
          <div className="mode-card-note">
            Trade-off: a tab opens (it can stay unfocused), and reading the answer depends on
            each site's layout, so it's a little more fragile than Direct API.
          </div>
        </div>

        <div className="card mode-card">
          <div className="mode-card-title">
            <Icon name="send" /> Direct API
          </div>
          <div className="mode-card-tag">Free Gemini key · fully inline</div>
          <div className="card-desc">
            Calls Google's Gemini API directly, so the summary, AI verdict, and community
            sentiment appear right on the video — <strong>no tab ever opens</strong>. The free
            tier covers ~500 videos a day with no credit card. This powers the on-page widget,
            ratings, and auto-summarize.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={goToDirectApi}>
            Set up Direct API →
          </button>
        </div>
      </div>

      <hr className="divider" />

      <div className="section-header">
        <h2 className="section-title" style={{ fontSize: 18 }}>Keyboard Shortcut</h2>
        <p className="section-desc">
          Chrome uses "suggested" shortcuts — they may need one-time confirmation.
        </p>
      </div>

      <div className="shortcut-box">
        <div className="shortcut-info">
          <div className="shortcut-label">Alt+Shift+G — Ask your default destination</div>
          <div className="shortcut-sub">
            If the shortcut isn't working, click the button to confirm it in Chrome's shortcuts manager.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd></span>
          <button className="btn btn-ghost" onClick={openShortcuts}>
            Set shortcut →
          </button>
        </div>
      </div>

      <div className="shortcut-box">
        <div className="shortcut-info">
          <div className="shortcut-label">Right-click a YouTube video</div>
          <div className="shortcut-sub">
            Right-click any YouTube watch page or Short to pick a specific
            profile without opening the popup.
          </div>
        </div>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Send to … with…</span>
      </div>

    </div>
  );
}
