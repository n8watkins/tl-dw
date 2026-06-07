export function SetupSection() {
  function openShortcuts() {
    void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Setup</h1>
        <p className="section-desc">Get TL;DW working in under two minutes.</p>
      </div>

      <div className="steps">
        <div className="step">
          <div className="step-num">Step 1</div>
          <div className="step-title">Open a YouTube video</div>
          <div className="step-body">
            Navigate to any YouTube watch page or Short. TL;DW detects the video
            automatically — no clicking required.
          </div>
        </div>
        <div className="step">
          <div className="step-num">Step 2</div>
          <div className="step-title">Press Alt+Shift+G</div>
          <div className="step-body">
            TL;DW builds your default prompt, opens your chosen AI (Gemini,
            ChatGPT, Claude, Perplexity, or NotebookLM) in a new tab, and
            auto-submits. The answer starts generating immediately.
          </div>
        </div>
        <div className="step">
          <div className="step-num">Step 3</div>
          <div className="step-title">Read, not watch</div>
          <div className="step-body">
            The AI analyzes the video and gives you the version you actually
            needed. Switch profiles for different kinds of analysis.
          </div>
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
          <div className="shortcut-label">Right-click toolbar icon</div>
          <div className="shortcut-sub">
            Right-click the TL;DW icon in Chrome's toolbar to pick a specific
            profile without opening the popup.
          </div>
        </div>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Ask Gemini with…</span>
      </div>

      <hr className="divider" />

      <div className="section-header">
        <h2 className="section-title" style={{ fontSize: 18 }}>Tips</h2>
      </div>

      <div className="tips-grid">
        <div className="tip">
          <strong>Change your default profile</strong>
          Go to Profiles, open any profile, and click "Set as Default." The
          shortcut always uses your default.
        </div>
        <div className="tip">
          <strong>Auto-submit is on by default</strong>
          Gemini receives and submits your prompt automatically. Turn it off in
          Settings if you want to review the prompt before sending.
        </div>
        <div className="tip">
          <strong>Works on Shorts too</strong>
          TL;DW detects both youtube.com/watch and youtube.com/shorts pages. The
          same shortcut and profiles work on both.
        </div>
        <div className="tip">
          <strong>{"{{userCuriosity}} in prompts"}</strong>
          Some profiles support a custom curiosity line. You can add it directly
          inside the prompt template in the Profiles editor.
        </div>
        <div className="tip">
          <strong>Edit any prompt</strong>
          Every built-in profile is fully editable. Open it in Profiles, change
          the template, and save. Use Reset to restore the original.
        </div>
        <div className="tip">
          <strong>Search history is private</strong>
          TL;DW saves the prompt you sent, never the Gemini response. Everything
          stays in Chrome's local storage — no servers, no accounts.
        </div>
      </div>
    </div>
  );
}
