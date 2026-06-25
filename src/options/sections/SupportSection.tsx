import { Icon } from "../components/Icons";

const KOFI_URL = "https://ko-fi.com/n8watkins";
const SITE_URL = "https://n8builds.dev";
const CONSULTING_URL = "https://appturnity.com/";
const GITHUB_URL = "https://github.com/n8watkins/tl-dw";
const ISSUES_URL = "https://github.com/n8watkins/tl-dw/issues";

export function SupportSection() {
  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Support the dev</h1>
        <p className="section-desc">
          TL;DW is built and maintained by one developer. If it saves you time, here are a few ways to
          support the work — or hire the person behind it.
        </p>
      </div>

      <div className="support-grid">
        <a className="support-card primary" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
          <span className="support-icon"><Icon name="kofi" /></span>
          <span>
            <strong>Buy me a Ko-fi</strong>
            <span>Tip a coffee to fund ongoing maintenance, polish, and new features.</span>
          </span>
        </a>

        <a className="support-card" href={SITE_URL} target="_blank" rel="noopener noreferrer">
          <span className="support-icon"><Icon name="globe" /></span>
          <span>
            <strong>n8builds.dev</strong>
            <span>The dev's personal site — projects, writing, and other tools worth a look.</span>
          </span>
        </a>

        <a className="support-card" href={CONSULTING_URL} target="_blank" rel="noopener noreferrer">
          <span className="support-icon"><Icon name="briefcase" /></span>
          <span>
            <strong>Hire me — Appturnity</strong>
            <span>Consulting & custom builds. Have a product idea? Let's ship it.</span>
          </span>
        </a>

        <a className="support-card" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <span className="support-icon"><Icon name="github" /></span>
          <span>
            <strong>GitHub repo</strong>
            <span>Star the project, read the source, and follow updates.</span>
          </span>
        </a>

        <a className="support-card" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
          <span className="support-icon"><Icon name="external" /></span>
          <span>
            <strong>Report an issue</strong>
            <span>Track bugs, rough edges, and feature requests.</span>
          </span>
        </a>
      </div>
    </div>
  );
}
