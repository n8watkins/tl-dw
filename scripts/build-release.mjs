import { execSync } from "child_process";
import {
  bumpPackageVersion,
  restoreVersionFiles,
  snapshotVersionFiles,
} from "./version-utils.mjs";

const snapshots = snapshotVersionFiles();
// Once `vite build` has run, dist/manifest.json carries the bumped version. If a
// later step (the Windows copy) fails, restoring package.json would leave it a
// version BEHIND what's in dist/. So only roll the version back when the failure
// happened before/during the build; after a successful build, keep it so
// package.json and dist/ agree.
let built = false;

try {
  const nextVersion = bumpPackageVersion();
  console.log(`[tl;dw] bumped version to ${nextVersion}`);

  execSync("vite build", { stdio: "inherit" });
  built = true;
  execSync("node scripts/copy-to-windows.mjs", { stdio: "inherit" });

  console.log(`[tl;dw] release build completed at ${nextVersion}`);
} catch (error) {
  if (!built) {
    restoreVersionFiles(snapshots);
    console.error("[tl;dw] release build failed before build; restored package versions.");
  } else {
    console.error(
      "[tl;dw] build succeeded but a later step failed; kept the bumped version to match dist/.",
    );
  }
  process.exit(typeof error.status === "number" ? error.status : 1);
}
