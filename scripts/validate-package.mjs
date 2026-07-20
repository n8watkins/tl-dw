import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const zipPath = path.join(root, "web-store", `tldw-${pkg.version}.zip`);

if (!fs.existsSync(zipPath)) {
  throw new Error(`Store package does not exist: ${zipPath}`);
}

const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

if (!listing.includes("manifest.json")) {
  throw new Error("manifest.json is not at the ZIP root");
}

const forbidden = listing.filter((name) =>
  name.endsWith(".map") ||
  /(^|\/)(node_modules|tests?|docs?|\.git|\.github)(\/|$)/.test(name) ||
  /(^|\/)\.env(?:\.|$)/.test(name) ||
  /\.(?:ts|tsx)$/.test(name),
);
if (forbidden.length > 0) {
  throw new Error(`Forbidden package artifacts:\n${forbidden.join("\n")}`);
}

const manifest = JSON.parse(execFileSync("unzip", ["-p", zipPath, "manifest.json"], { encoding: "utf8" }));
if (manifest.version !== pkg.version) {
  throw new Error(`Manifest version ${manifest.version} does not match package version ${pkg.version}`);
}

const archiveText = execFileSync("unzip", ["-p", zipPath], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (/AIza[0-9A-Za-z_-]{20,}/.test(archiveText)) {
  throw new Error("Package contains material that resembles a Google API key");
}

console.log(`[tl;dw] validated web-store/tldw-${pkg.version}.zip (${listing.length} files)`);
