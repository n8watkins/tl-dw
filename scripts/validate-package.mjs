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

// The base install asks only for YouTube and Gemini; everything else is an
// optional permission requested when the user picks that feature.
const BASE_HOSTS = [
  "https://www.youtube.com/*",
  "https://gemini.google.com/*",
  "https://generativelanguage.googleapis.com/*",
];
const hosts = manifest.host_permissions ?? [];
if (JSON.stringify([...hosts].sort()) !== JSON.stringify([...BASE_HOSTS].sort())) {
  throw new Error(`Unexpected host_permissions (an e2e build?): ${hosts.join(", ")}`);
}
// TL;DW is Gemini-only: SponsorBlock is the one optional host, and nothing
// registers scripts at runtime.
const OPTIONAL_HOSTS = ["https://sponsor.ajay.app/*"];
if (JSON.stringify(manifest.optional_host_permissions ?? []) !== JSON.stringify(OPTIONAL_HOSTS)) {
  throw new Error(`optional_host_permissions must be exactly ${OPTIONAL_HOSTS.join(", ")}`);
}
const EXPECTED_PERMISSIONS = ["clipboardWrite", "contextMenus", "storage"];
if (JSON.stringify([...(manifest.permissions ?? [])].sort()) !== JSON.stringify(EXPECTED_PERMISSIONS)) {
  throw new Error(`permissions must be exactly ${EXPECTED_PERMISSIONS.join(", ")}`);
}
const contentScriptHosts = (manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []);
const extraHosts = contentScriptHosts.filter((m) => !BASE_HOSTS.includes(m));
if (extraHosts.length > 0) {
  throw new Error(`Content scripts match hosts outside the base install: ${extraHosts.join(", ")}`);
}

const archiveText = execFileSync("unzip", ["-p", zipPath], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (/AIza[0-9A-Za-z_-]{20,}/.test(archiveText)) {
  throw new Error("Package contains material that resembles a Google API key");
}

console.log(`[tl;dw] validated web-store/tldw-${pkg.version}.zip (${listing.length} files)`);
