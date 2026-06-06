import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

export default defineManifest({
  manifest_version: 3,
  name: "TL;DW",
  short_name: "TL;DW",
  version: pkg.version,
  description:
    "Too Long; Didn't Watch for YouTube. Send the current video to Gemini in one keystroke.",
  icons: {
    16: "icons/tl-dw-16.png",
    32: "icons/tl-dw-32.png",
    48: "icons/tl-dw-48.png",
    128: "icons/tl-dw-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_title: "TL;DW — Ask Gemini about this video",
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
      matches: [
        "https://gemini.google.com/*",
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*",
        "https://www.perplexity.ai/*",
        "https://perplexity.ai/*",
        "https://notebooklm.google.com/*",
      ],
      js: ["src/content/inject.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"],
      js: ["src/content/youtube-intercept.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"],
      js: ["src/content/youtube.ts"],
      run_at: "document_idle",
    },
  ],
  commands: {
    "ask-gemini": {
      suggested_key: {
        default: "Alt+Shift+G",
        mac: "Command+Shift+G",
      },
      description: "Ask Gemini about the current YouTube video",
    },
  },
  permissions: ["storage", "tabs", "contextMenus", "clipboardWrite"],
  host_permissions: [
    "https://www.youtube.com/*",
    "https://youtube.com/*",
    "https://gemini.google.com/*",
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://www.perplexity.ai/*",
    "https://perplexity.ai/*",
    "https://notebooklm.google.com/*",
  ],
});
