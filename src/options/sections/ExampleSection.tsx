import { EXAMPLE_SUMMARY as EX } from "../../lib/exampleSummary";
import { formatClock } from "../../lib/timedTranscript";

const ICON_URL = chrome.runtime.getURL("icons/tl-dw-48.png");

/**
 * options#example: a real summary that ships with TL;DW, laid out like the
 * panel TL;DW puts under a video. It needs no key and sends nothing; the only
 * way off the page is the user following a link to the video.
 */
export function ExampleSection({ onBack }: { onBack: () => void }) {
  return (
    <div className="welcome example">
      <header className="example-head">
        <p className="welcome-kicker">Example summary</p>
        <h1 className="welcome-title">This is what TL;DW puts under a video.</h1>
        <p className="welcome-lede">
          A real summary TL;DW made of one public video. It comes with TL;DW, so this page needs
          no key and sends nothing.
        </p>
      </header>

      <article className="example-panel" aria-label="Example summary">
        <div className="example-panel-head">
          <img src={ICON_URL} alt="" width={22} height={22} />
          <span className="example-panel-name">TL;DW</span>
          <span className="example-panel-sub">· {EX.tldw.profileName} · Gemini tab (no key)</span>
        </div>
        <p className="example-summary">{EX.tldw.summary}</p>
        <ul className="example-points">
          {EX.tldw.items.map((item) => (
            <li key={item.time}>
              <a
                className="example-time"
                href={`${EX.videoUrl}&t=${item.time}s`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Watch from ${formatClock(item.time)}`}
              >
                {formatClock(item.time)}
              </a>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        <p className="example-source">
          From the transcript · times checked against the captions · made on {EX.madeOn} with
          TL;DW's Quick style and no key
        </p>
      </article>

      <section className="example-video" aria-label="The video">
        <div>
          <div className="example-video-title">{EX.videoTitle}</div>
          <div className="example-video-channel">{EX.channel}</div>
        </div>
        <a className="btn btn-primary" href={EX.videoUrl} target="_blank" rel="noreferrer">
          Watch it on YouTube ↗
        </a>
      </section>

      <p className="welcome-fine">
        On the video's page, press the blue <strong>TL;DW</strong> button under the video to make
        a fresh summary yourself. A time takes you to that moment in the video.
      </p>
      <div className="welcome-actions">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
