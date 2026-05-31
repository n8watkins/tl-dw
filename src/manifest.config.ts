import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

export default defineManifest({
  manifest_version: 3,
  name: "TLDW — Too Long; Didn't Watch",
  version: pkg.version,
  description:
    "Send the current YouTube video to Gemini in one keystroke (Ctrl+Shift+G).",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "TLDW — Ask Gemini about this video",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://gemini.google.com/*"],
      js: ["src/content/gemini.ts"],
      run_at: "document_idle",
    },
  ],
  commands: {
    "ask-gemini": {
      suggested_key: {
        default: "Ctrl+Shift+G",
        mac: "Command+Shift+G",
      },
      description: "Ask Gemini about the current YouTube video",
    },
  },
  permissions: ["storage", "tabs"],
  host_permissions: [
    "https://www.youtube.com/*",
    "https://youtube.com/*",
    "https://gemini.google.com/*",
  ],
});
