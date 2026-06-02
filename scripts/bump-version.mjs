import { bumpPackageVersion } from "./version-utils.mjs";

const nextVersion = bumpPackageVersion();
console.log(`[tl;dw] bumped version to ${nextVersion}`);
