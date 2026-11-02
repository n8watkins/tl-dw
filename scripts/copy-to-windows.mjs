/**
 * Optionally copies the built dist/ to the folder Chrome loads the extension
 * from (for example a Windows folder when building in WSL). Run by
 * `npm run build` after vite build.
 *
 * Opt-in: set TLDW_COPY_DIR to the destination folder. Without it this does
 * nothing, so forks and CI build cleanly.
 *   TLDW_COPY_DIR=/mnt/c/Users/<you>/Projects/Tools/tldw npm run build
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const dest = process.env.TLDW_COPY_DIR?.trim();
if (!dest) {
  console.log("[tl;dw] TLDW_COPY_DIR is not set; load the extension from dist/.");
  process.exit(0);
}

const src = path.resolve(import.meta.dirname, "../dist");

if (!fs.existsSync(src)) {
  console.error("[tl;dw] dist/ not found - did the build succeed?");
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });

try {
  // rsync handles WSL's 9p filesystem well and removes stale files.
  execSync(`rsync -a --delete "${src}/" "${dest}/"`, { stdio: "inherit" });
  console.log(`[tl;dw] Copied dist/ -> ${dest}`);
} catch {
  // No rsync: fall back to cp.
  execSync(`cp -r "${src}/." "${dest}/"`, { stdio: "inherit" });
  console.log(`[tl;dw] Copied dist/ -> ${dest} (cp fallback)`);
}
