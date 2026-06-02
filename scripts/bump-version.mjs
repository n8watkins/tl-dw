import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const files = [
  path.join(root, "package.json"),
  path.join(root, "package-lock.json"),
];

function bumpPatch(version) {
  const parts = version.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Expected semantic version x.y.z, got "${version}"`);
  }

  parts[2] += 1;
  return parts.join(".");
}

const packagePath = files[0];
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const nextVersion = bumpPatch(pkg.version);
pkg.version = nextVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const lockPath = files[1];
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.name = pkg.name;
  lock.version = nextVersion;

  if (lock.packages?.[""]) {
    lock.packages[""].name = pkg.name;
    lock.packages[""].version = nextVersion;
  }

  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

console.log(`[tl;dw] bumped version to ${nextVersion}`);
