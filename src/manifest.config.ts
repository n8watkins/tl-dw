import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

// The chat sites other than Gemini, and SponsorBlock, are optional host
// permissions: TL;DW asks for them when the user picks that feature. The e2e
// build (TLDW_E2E=1) grants them up front, because a headless test can't click
// Chrome's permission prompt.
const OPTIONAL_HOSTS = [
  "https://chatgpt.com/*",
  "https://claude.ai/*",
  "https://notebooklm.google.com/*",
  "https://sponsor.ajay.app/*",
];
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const grantOptionalHosts = env.TLDW_E2E === "1";

export default defineManifest({
  manifest_version: 3,
  // The store listing's name. Several store items are already called TLDW or
  // TL;DW, so the listing says what it is; short_name and the UI stay "TL;DW".
  name: "TL;DW: YouTube Summaries with Gemini",
  short_name: "TL;DW",
  version: pkg.version,
  // chrome.runtime.getContexts (finding an open options tab without the "tabs"
  // permission) needs Chrome 116; `world: "MAIN"` content scripts need 111.
  minimum_chrome_version: "116",
  description:
    "Too Long; Didn't Watch: summarize any YouTube video right on the page with Gemini, or send it to ChatGPT, Claude or NotebookLM.",
  icons: {
    16: "icons/tl-dw-16.png",
    32: "icons/tl-dw-32.png",
    48: "icons/tl-dw-48.png",
    128: "icons/tl-dw-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_title: "TL;DW: summarize this video",
    default_icon: {
      16: "icons/tl-dw-16.png",
      32: "icons/tl-dw-32.png",
      48: "icons/tl-dw-48.png",
      128: "icons/tl-dw-128.png",
    },
  },
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      // The other chat sites get the same script, registered at runtime once
      // the user allows that site (see syncInjectorRegistration).
      matches: ["https://gemini.google.com/*"],
      js: ["src/content/inject.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://www.youtube.com/*"],
      js: ["src/content/youtube-intercept.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      matches: ["https://www.youtube.com/*"],
      js: ["src/content/youtube.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://www.youtube.com/*"],
      js: ["src/content/sponsorblock.ts"],
      run_at: "document_idle",
    },
  ],
  commands: {
    "ask-gemini": {
      suggested_key: {
        default: "Alt+Shift+G",
        mac: "Command+Shift+G",
      },
      description: "Summarize with TL;DW",
    },
  },
  web_accessible_resources: [
    {
      resources: ["icons/*.png"],
      matches: ["https://www.youtube.com/*"],
    },
  ],
  permissions: ["storage", "contextMenus", "clipboardWrite", "scripting"],
  host_permissions: [
    "https://www.youtube.com/*",
    "https://gemini.google.com/*",
    "https://generativelanguage.googleapis.com/*",
    ...(grantOptionalHosts ? OPTIONAL_HOSTS : []),
  ],
  optional_host_permissions: grantOptionalHosts ? [] : OPTIONAL_HOSTS,
});
