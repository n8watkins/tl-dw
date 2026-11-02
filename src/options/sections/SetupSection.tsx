import { Icon } from "../components/Icons";
import { shortcutKeys, useSummarizeShortcut } from "../../lib/useShortcut";

/** A shortcut as keycaps: Alt + Shift + G. */
function Keys({ shortcut }: { shortcut: string }) {
  return (
    <span className="keys">
      {shortcutKeys(shortcut).map((k, i) => (
        <span key={i}>{i > 0 && " + "}<kbd>{k}</kbd></span>
      ))}
    </span>
  );
}

function StepYouTubeIcon() {
  return (
    <svg width={34} height={24} viewBox="0 0 34 24" aria-hidden="true">
      <rect width="34" height="24" rx="5" fill="currentColor" />
      <polygon points="13,6 13,18 24.5,12" fill="white" />
    </svg>
  );
}

export function SetupSection() {
  const shortcut = useSummarizeShortcut();

  function openShortcuts() {
    void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  function goToDirectApi() {
    window.location.hash = "directapi";
  }

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Summarize any YouTube video.</h1>
        <p className="section-desc">
          TL;DW reads the video's transcript and puts an AI summary right under the video, shaped by
          your profiles and tags, so you can decide whether a video is worth your time before you spend it.
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
            Open any video (Shorts aren't supported). A blue TL;DW button appears next to Subscribe.
          </div>
        </div>
        <div className="step">
          <div className="step-icon step-icon-purple">
            <Icon name="sparkles" />
          </div>
          <div className="step-num">Step 2</div>
          <div className="step-title">Press TL;DW</div>
          <div className="step-body">
            Click the button{shortcut ? <> or press <Keys shortcut={shortcut} /></> : null}. With a Gemini
            key the summary comes straight from the API; without one, Gemini works in a background tab.
          </div>
        </div>
        <div className="step">
          <div className="step-icon step-icon-teal">
            <Icon name="eye" />
          </div>
          <div className="step-num">Step 3</div>
          <div className="step-title">Read the summary</div>
          <div className="step-body">
            The summary lands under the video: a one-line takeaway plus the key details. Skip what
            doesn't matter.
          </div>
        </div>
      </div>

      <hr className="divider" />

      <div className="section-header">
        <h2 className="section-title" style={{ fontSize: 18 }}>Two ways to summarize</h2>
        <p className="section-desc">
          TL;DW works without any setup. A free Gemini API key makes it faster and handles more videos.
        </p>
      </div>

      <div className="mode-grid">
        <div className="card mode-card">
          <div className="mode-card-title">
            <Icon name="sparkles" /> Open in a tab
          </div>
          <div className="mode-card-tag">No key · works now</div>
          <div className="card-desc">
            TL;DW opens your chosen AI (Gemini by default, or ChatGPT, Claude or NotebookLM) in a
            background tab, with the prompt typed and sent, then reads the finished answer and puts the
            summary on the YouTube page. It uses the account you're already signed in with.
          </div>
          <div className="mode-card-note">
            Long videos: Gemini watches them from the link; ChatGPT and Claude ask you what to do.
            Reading the answer depends on each site's layout, so it's a little more fragile than Direct API.
          </div>
        </div>

        <div className="card mode-card">
          <div className="mode-card-title">
            <Icon name="send" /> Direct API
          </div>
          <div className="mode-card-tag">Your free Gemini key · recommended</div>
          <div className="card-desc">
            Calls Google's Gemini API with your own key, so the summary appears under the video in
            seconds with <strong>no tab</strong>. Long videos are summarized from the full transcript,
            and Gemini watches videos that have no captions. Getting a free key takes about two minutes.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={goToDirectApi}>
            Set up Direct API →
          </button>
        </div>
      </div>

      <hr className="divider" />

      <div className="section-header">
        <h2 className="section-title" style={{ fontSize: 18 }}>Keyboard shortcut</h2>
        <p className="section-desc">
          The shortcut sends the video to your default destination in a tab, with your default profile.
        </p>
      </div>

      <div className="shortcut-box">
        <div className="shortcut-info">
          <div className="shortcut-label">Summarize with TL;DW</div>
          <div className="shortcut-sub">
            {shortcut === null
              ? "Checking your shortcut…"
              : shortcut
                ? "Change it in Chrome's keyboard shortcuts page."
                : "No shortcut is set (another extension may use it). Pick one in Chrome's keyboard shortcuts page."}
          </div>
        </div>
        <div className="shortcut-actions">
          {shortcut ? <Keys shortcut={shortcut} /> : null}
          <button className="btn btn-ghost" onClick={openShortcuts}>
            {shortcut ? "Change shortcut →" : "Set shortcut →"}
          </button>
        </div>
      </div>

      <div className="shortcut-box">
        <div className="shortcut-info">
          <div className="shortcut-label">Right-click a YouTube video</div>
          <div className="shortcut-sub">
            Right-click any YouTube watch page to pick a specific
            profile without opening the popup.
          </div>
        </div>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Send to … with…</span>
      </div>

    </div>
  );
}
