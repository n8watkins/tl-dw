import { useEffect, useState } from "react";
import type { Settings } from "../../types";
import { AI_STUDIO_LINKS, DEFAULT_SETTINGS, STORAGE_KEYS } from "../../lib/constants";
import { getSettings } from "../../lib/storage";
import { shortcutKeys, useSummarizeShortcut } from "../../lib/useShortcut";
import { GeminiKeyForm } from "../components/GeminiKeyForm";
import { EXAMPLE_SUMMARY } from "../../lib/exampleSummary";

const ICON_URL = chrome.runtime.getURL("icons/tl-dw-128.png");
/** A video to try TL;DW on: the one the bundled example summary is made from. */
const TRY_VIDEO_URL = `https://www.youtube.com/watch?v=${EXAMPLE_SUMMARY.videoId}`;

/**
 * First-install page (options#welcome), one desktop screen: the two ways TL;DW
 * works as two cards (no key: try it now; a free Gemini key: three steps and
 * the field to paste it), with the fine print behind "More details".
 */
export function WelcomeSection({ onDone }: { onDone: () => void }) {
  const [settings, setLocal] = useState<Settings | null>(null);
  const shortcut = useSummarizeShortcut();

  useEffect(() => {
    void getSettings().then(setLocal);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[STORAGE_KEYS.settings]?.newValue) {
        setLocal({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) });
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (!settings) return <p className="text-muted welcome-loading">Loading…</p>;

  const keyReady = settings.geminiKeyValidation.status === "valid" && settings.useDirectApi;
  const keys = shortcut
    ? <>, or {shortcutKeys(shortcut).map((k, i) => <span key={i}>{i > 0 && "+"}<kbd>{k}</kbd></span>)}</>
    : null;

  return (
    <div className="welcome">
      <header className="welcome-hero">
        <img className="welcome-icon" src={ICON_URL} alt="" />
        <div>
          <p className="welcome-kicker">TL;DW is installed</p>
          <h1 className="welcome-title">Summarize any YouTube video</h1>
          <p className="welcome-lede">Open a video and press the blue <strong>TL;DW</strong> button under it{keys}.</p>
        </div>
      </header>

      <section aria-labelledby="welcome-modes">
        <h2 id="welcome-modes" className="welcome-h2">Two ways it works</h2>
        <div className="welcome-modes">
          <div className="welcome-mode">
            <div className="welcome-mode-tag">Works now</div>
            <h3>No key</h3>
            <p>TL;DW asks Gemini in a tab behind the video and puts the answer on the YouTube page.</p>
            <div className="welcome-mode-actions">
              <a className="btn btn-ghost" href={TRY_VIDEO_URL} target="_blank" rel="noreferrer">Try it ↗</a>
              <span className="welcome-mode-link"><a href="#example">See an example summary</a></span>
            </div>
          </div>

          <div className="welcome-mode welcome-mode-recommended">
            <div className="welcome-mode-tag">Recommended · free</div>
            <h3>Your free Gemini key</h3>
            <p>Summaries in seconds, right on the page, with no extra tab.</p>
            {keyReady ? (
              <div className="welcome-done" role="status">
                <strong>You're set: your key is on.</strong> Open any video and press <strong>TL;DW</strong>.
                <div className="welcome-mode-actions">
                  <a className="btn btn-primary" href={TRY_VIDEO_URL} target="_blank" rel="noreferrer">Try it ↗</a>
                </div>
              </div>
            ) : (
              <ol className="welcome-steps">
                <li>
                  Open <a href={AI_STUDIO_LINKS.apiKeys} target="_blank" rel="noreferrer">Google AI Studio ↗</a> and sign in.
                </li>
                <li>Click <strong>Create API key</strong> and copy it.</li>
                <li>
                  Paste it here:
                  <div className="welcome-form">
                    <GeminiKeyForm settings={settings} idPrefix="welcome-key" compact />
                  </div>
                </li>
              </ol>
            )}
          </div>
        </div>
      </section>

      <div className="welcome-footer">
      <details className="welcome-more">
        <summary>More details</summary>
        <p>
          <strong>No key:</strong> Gemini runs with the Google account you're signed in with. Signed in, it
          reads even a long video's transcript through YouTube; signed out, a long video is summarized from
          part of its transcript. Without a key Gemini doesn't watch videos, so for one with no captions it
          can only summarize public info about it.
        </p>
        <p>
          <strong>Your key:</strong> long videos are summarized from the full transcript, and Gemini watches
          videos that have no captions. If AI Studio asks for a project, pick or create one. The key stays in
          this browser and is sent only to Google's Gemini API. The free tier needs no billing; on it, Google
          may use what you send to improve its products (
          <a href={AI_STUDIO_LINKS.terms} target="_blank" rel="noreferrer">Gemini API terms ↗</a>
          ). Limits depend on the model:{" "}
          <a href={AI_STUDIO_LINKS.rateLimitDocs} target="_blank" rel="noreferrer">rate limits ↗</a>.
          You can add, check or remove the key any time in TL;DW settings, under Your Gemini key.
        </p>
      </details>
      <button className="welcome-settings-link" onClick={onDone}>All settings</button>
      </div>
    </div>
  );
}
