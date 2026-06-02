import { execSync } from "child_process";
import {
  bumpPackageVersion,
  restoreVersionFiles,
  snapshotVersionFiles,
} from "./version-utils.mjs";

const snapshots = snapshotVersionFiles();

try {
  const nextVersion = bumpPackageVersion();
  console.log(`[tl;dw] bumped version to ${nextVersion}`);

  execSync("vite build", { stdio: "inherit" });
  execSync("node scripts/copy-to-windows.mjs", { stdio: "inherit" });

  console.log(`[tl;dw] release build completed at ${nextVersion}`);
} catch (error) {
  restoreVersionFiles(snapshots);
  console.error("[tl;dw] release build failed; restored package versions.");
  process.exit(typeof error.status === "number" ? error.status : 1);
}
