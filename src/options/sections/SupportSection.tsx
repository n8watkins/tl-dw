import { Icon } from "../components/Icons";

const GITHUB_URL = "https://github.com/n8watkins/tl-dw";
const ISSUES_URL = "https://github.com/n8watkins/tl-dw/issues";
const COFFEE_URL = "https://www.buymeacoffee.com/n8watkins";

export function SupportSection() {
  const version = chrome.runtime.getManifest().version;

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Support</h1>
        <p className="section-desc">Keep TL;DW useful, maintained, and easy to run locally.</p>
      </div>

      <div className="support-grid">
        <a className="support-card primary" href={COFFEE_URL} target="_blank" rel="noreferrer">
          <span className="support-icon"><Icon name="coffee" /></span>
          <span>
            <strong>Buy a coffee</strong>
            <span>Support ongoing maintenance and polish.</span>
          </span>
        </a>

        <a className="support-card" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <span className="support-icon"><Icon name="github" /></span>
          <span>
            <strong>GitHub repo</strong>
            <span>View source, commits, and project updates.</span>
          </span>
        </a>

        <a className="support-card" href={ISSUES_URL} target="_blank" rel="noreferrer">
          <span className="support-icon"><Icon name="external" /></span>
          <span>
            <strong>Report an issue</strong>
            <span>Track bugs, rough edges, and feature requests.</span>
          </span>
        </a>
      </div>

      <div className="version-panel">
        <span>Current version</span>
        <strong>v{version}</strong>
      </div>
    </div>
  );
}
