/**
 * Packages the built extension into an uploadable Chrome Web Store .zip.
 *
 * Runs `vite build` (NO version bump, NO Windows copy — unlike the release
 * build) and zips the CONTENTS of dist/ so manifest.json sits at the archive
 * root, which is what the Web Store Developer Dashboard expects.
 *
 *   npm run package   ->   web-store/tldw-<version>.zip
 *
 * Each public upload needs a version strictly higher than the last published
 * one. This script does NOT bump the version; run `npm version patch` (or edit
 * package.json) first if you need a new number.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const distDir = path.join(root, "dist");
const outDir = path.join(root, "web-store");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const zipName = `tldw-${pkg.version}.zip`;
const zipPath = path.join(outDir, zipName);

console.log("[tl;dw] building dist/ for the Web Store…");
execSync("vite build", { stdio: "inherit", cwd: root });

if (!fs.existsSync(path.join(distDir, "manifest.json"))) {
  console.error("[tl;dw] dist/manifest.json missing — build failed?");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

try {
  // Zip the contents of dist/ (manifest.json at the root), skipping dotfiles.
  execSync(`zip -r -X "${zipPath}" . -x ".*"`, { stdio: "inherit", cwd: distDir });
} catch {
  console.error('[tl;dw] `zip` not found. Install it (e.g. "sudo apt-get install zip") or zip dist/ manually.');
  process.exit(1);
}

const sizeKB = Math.round(fs.statSync(zipPath).size / 1024);
console.log(`\n[tl;dw] packaged -> web-store/${zipName} (${sizeKB} KB, manifest v${pkg.version})`);
console.log("[tl;dw] upload at https://chrome.google.com/webstore/devconsole — see docs/STORE_SUBMISSION.md");
