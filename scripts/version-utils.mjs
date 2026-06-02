import fs from "fs";
import path from "path";

export const root = path.resolve(import.meta.dirname, "..");
export const packagePath = path.join(root, "package.json");
export const lockPath = path.join(root, "package-lock.json");
export const versionFiles = [packagePath, lockPath];

export function snapshotVersionFiles() {
  return new Map(
    versionFiles.map((file) => [
      file,
      fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null,
    ]),
  );
}

export function restoreVersionFiles(snapshots) {
  for (const [file, content] of snapshots) {
    if (content === null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      continue;
    }

    fs.writeFileSync(file, content);
  }
}

export function bumpPatch(version) {
  const parts = version.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Expected semantic version x.y.z, got "${version}"`);
  }

  parts[2] += 1;
  return parts.join(".");
}

export function bumpPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const nextVersion = bumpPatch(pkg.version);
  pkg.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

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

  return nextVersion;
}
