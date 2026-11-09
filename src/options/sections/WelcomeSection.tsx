import { useEffect, useState } from "react";
import type { Settings } from "../../types";
import { AI_STUDIO_LINKS, DEFAULT_SETTINGS, STORAGE_KEYS } from "../../lib/constants";
import { getSettings } from "../../lib/storage";
import { shortcutKeys, useSummarizeShortcut } from "../../lib/useShortcut";
import { GeminiKeyForm } from "../components/GeminiKeyForm";

const ICON_URL = chrome.runtime.getURL("icons/tl-dw-128.png");

/** Close this tab (it was opened by TL;DW on install). */
function closeTab() {
  void chrome.tabs.getCurrent().then((tab) => {
    if (tab?.id !== undefined) void chrome.tabs.remove(tab.id);
    else window.close();
  });
}

/**
 * First-install page (options#welcome): what the two ways of summarizing are,
 * and how to get a free Gemini API key in about two minutes, or skip it and
 * use TL;DW without one.
 */
export function WelcomeSection({ onDone }: { onDone: () => void }) {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [skipped, setSkipped] = useState(false);
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
  const how = shortcut
    ? <>press the blue <strong>TL;DW</strong> button under it, or {shortcutKeys(shortcut).map((k, i) => (
        <span key={i}>{i > 0 && "+"}<kbd>{k}</kbd></span>
      ))}</>
    : <>press the blue <strong>TL;DW</strong> button under it</>;

  return (
    <div className="welcome">
      <header className="welcome-hero">
        <img className="welcome-icon" src={ICON_URL} alt="" />
        <div>
          <p className="welcome-kicker">TL;DW is installed</p>
          <h1 className="welcome-title">Summarize any YouTube video, right where you watch it.</h1>
          <p className="welcome-lede">Open a video and {how}.</p>
        </div>
      </header>

      <section aria-labelledby="welcome-modes" className="welcome-section">
        <h2 id="welcome-modes" className="welcome-h2">Two ways it works</h2>
        <div className="welcome-modes">
          <div className="welcome-mode">
            <div className="welcome-mode-tag">Works now, no key</div>
            <h3>Gemini in a background tab</h3>
            <p>
              TL;DW opens Gemini in a tab behind the video, using the Google account you're signed in
              with, and puts Gemini's answer on the YouTube page. Signed in, Gemini reads even a long
              video's transcript through YouTube; signed out, a long video's summary comes from part
              of its transcript. Without a key Gemini doesn't watch videos, so for one with no
              captions it can only summarize public info about it.
            </p>
          </div>
          <div className="welcome-mode welcome-mode-recommended">
            <div className="welcome-mode-tag">Recommended · free</div>
            <h3>Your own Gemini API key</h3>
            <p>
              The summary appears on the page in seconds, with no tab. Long videos are summarized
              from the full transcript, and Gemini watches videos that have no captions.
            </p>
          </div>
        </div>
        {!keyReady && (
          <p className="welcome-fine welcome-example-link">
            Want to see one first? <a href="#example">See an example summary</a>, no key needed.
          </p>
        )}
      </section>

      {keyReady ? (
        <section className="welcome-section welcome-done" role="status">
          <h2 className="welcome-h2">You're set: Direct API is on.</h2>
          <p>Open any YouTube video and {how}. The summary appears right under the video.</p>
          <div className="welcome-actions">
            <a className="btn btn-primary" href="https://www.youtube.com/" target="_blank" rel="noreferrer">
              Open YouTube
            </a>
            <button className="btn btn-ghost" onClick={onDone}>See all settings</button>
          </div>
        </section>
      ) : skipped ? (
        <section className="welcome-section welcome-done" role="status">
          <h2 className="welcome-h2">You're set: TL;DW will use Gemini in a tab.</h2>
          <p>
            Open any YouTube video and {how}. You can add a free key any time in TL;DW settings,
            under Direct API.
          </p>
          <div className="welcome-actions">
            <a className="btn btn-primary" href="https://www.youtube.com/" target="_blank" rel="noreferrer">
              Open YouTube
            </a>
            <button className="btn btn-ghost" onClick={() => setSkipped(false)}>Add a key after all</button>
            <button className="btn btn-ghost" onClick={closeTab}>Close this tab</button>
          </div>
        </section>
      ) : (
        <section aria-labelledby="welcome-key" className="welcome-section welcome-key">
          <h2 id="welcome-key" className="welcome-h2">Get your free Gemini key (about 2 minutes)</h2>
          <ol className="welcome-steps">
            <li>
              Open{" "}
              <a href={AI_STUDIO_LINKS.apiKeys} target="_blank" rel="noreferrer">Google AI Studio ↗</a>{" "}
              and sign in with your Google account.
            </li>
            <li>
              Click <strong>Create API key</strong>. If it asks for a project, pick or create one
              (a project just for TL;DW is optional).
            </li>
            <li>Copy the key and paste it here. TL;DW checks it with Google and turns Direct API on.</li>
          </ol>
          <div className="welcome-form">
            <GeminiKeyForm settings={settings} idPrefix="welcome-key" />
          </div>
          <p className="welcome-fine">
            The key stays in this browser and is sent only to Google's Gemini API. The free tier needs no
            billing; on it, Google may use what you send to improve its products (
            <a href={AI_STUDIO_LINKS.terms} target="_blank" rel="noreferrer">Gemini API terms ↗</a>
            ). Limits depend on the model:{" "}
            <a href={AI_STUDIO_LINKS.rateLimitDocs} target="_blank" rel="noreferrer">rate limits ↗</a>.
          </p>
          <div className="welcome-actions">
            <button className="btn btn-ghost" onClick={() => setSkipped(true)}>
              Skip, use without a key
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
