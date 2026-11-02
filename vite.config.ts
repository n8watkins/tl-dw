import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.config";

/**
 * crxjs exposes a `?script&iife` file to every site as a web-accessible
 * resource. The optional-site injector is registered with
 * chrome.scripting.registerContentScripts and never loaded by a web page, so
 * drop that entry: no site should be able to probe for the extension through it.
 */
function dropWildcardScriptResources(): Plugin {
  return {
    name: "tldw:drop-wildcard-script-resources",
    enforce: "post",
    // crxjs finishes manifest.json after the bundle is generated, so edit the
    // written file.
    writeBundle(options) {
      const file = path.join(options.dir ?? "dist", "manifest.json");
      if (!fs.existsSync(file)) return;
      const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
        web_accessible_resources?: { matches?: string[]; resources: string[] }[];
      };
      json.web_accessible_resources = json.web_accessible_resources
        ?.map((entry) => ({ ...entry, resources: entry.resources.filter((r) => !r.endsWith("inject-optional.js")) }))
        .filter((entry) => entry.resources.length > 0);
      fs.writeFileSync(file, JSON.stringify(json, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), dropWildcardScriptResources()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
