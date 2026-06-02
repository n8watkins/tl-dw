/**
 * Copies the built dist/ to the Windows folder Chrome loads the extension from.
 * Run automatically via the "build" npm script after vite build.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const WINDOWS_DEST = "/mnt/c/Users/natha/Projects/Tools/tldw";

const src = path.resolve(import.meta.dirname, "../dist");

if (!fs.existsSync(src)) {
  console.error("[tl;dw] dist/ not found — did the build succeed?");
  process.exit(1);
}

if (!fs.existsSync(WINDOWS_DEST)) {
  fs.mkdirSync(WINDOWS_DEST, { recursive: true });
}

try {
  // rsync is available in WSL and handles the 9p fs well
  execSync(`rsync -a --delete "${src}/" "${WINDOWS_DEST}/"`, {
    stdio: "inherit",
  });
  console.log(`[tl;dw] Copied dist/ -> ${WINDOWS_DEST}`);
} catch {
  // rsync not available — fall back to cp
  execSync(`cp -r "${src}/." "${WINDOWS_DEST}/"`, { stdio: "inherit" });
  console.log(`[tl;dw] Copied dist/ -> ${WINDOWS_DEST} (cp fallback)`);
}
