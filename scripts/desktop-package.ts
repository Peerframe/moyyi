import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildCandidate, command, repository } from "./packaging.ts";

assert(
  process.platform === "darwin" && process.arch === "arm64",
  "Desktop packaging supports macOS arm64 only",
);
const nodeVersion = "26.12.1";
const nodeArchive = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
const nodeSha256 = "1901d539912c02afa10d1cc126943a8855a7eedebe830119463470db5e6c59e8";
const output = join(repository, "artifacts/desktop");
const cache = join(output, "cache");
mkdirSync(cache, { recursive: true });
const archive = join(cache, nodeArchive);
if (!existsSync(archive)) {
  const pending = `${archive}.part`;
  try {
    command(
      "/usr/bin/curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "170",
        "--output",
        pending,
        `https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`,
      ],
      repository,
    );
    assert.equal(
      createHash("sha256").update(readFileSync(pending)).digest("hex"),
      nodeSha256,
      "Node archive hash mismatch",
    );
    renameSync(pending, archive);
  } finally {
    rmSync(pending, { force: true });
  }
}
assert.equal(
  createHash("sha256").update(readFileSync(archive)).digest("hex"),
  nodeSha256,
  "Cached Node archive hash mismatch",
);
const nodeSource = join(cache, `node-v${nodeVersion}-darwin-arm64`);
if (!existsSync(nodeSource)) command("/usr/bin/tar", ["-xzf", archive, "-C", cache], repository);
assert.equal(
  command(join(nodeSource, "bin/node"), ["--version"], repository).trim(),
  `v${nodeVersion}`,
);
const candidate = buildCandidate();
command("npm", ["run", "desktop:build"], repository);
const app = join(output, "Moyyi.app");
rmSync(app, { recursive: true, force: true });
const electron = join(repository, "node_modules/electron/dist");
assert(
  existsSync(join(electron, "Electron.app")),
  "Run node node_modules/electron/install.js first",
);
command("/usr/bin/ditto", [join(electron, "Electron.app"), app], repository);
const resources = join(app, "Contents/Resources");
rmSync(join(resources, "default_app.asar"), { force: true });
command(
  "/usr/bin/xcrun",
  [
    "swiftc",
    "-O",
    "-target",
    "arm64-apple-macos14.0",
    join(repository, "apps/desktop/native/keychain.swift"),
    "-o",
    join(resources, "keychain-helper"),
  ],
  repository,
);
const appDirectory = join(resources, "app");
cpSync(join(output, "app"), appDirectory, { recursive: true });
mkdirSync(join(resources, "node/bin"), { recursive: true });
cpSync(join(nodeSource, "bin/node"), join(resources, "node/bin/node"));
cpSync(join(nodeSource, "LICENSE"), join(resources, "node/LICENSE"));
command(
  "npm",
  [
    "install",
    "--prefix",
    appDirectory,
    "--omit=dev",
    "--ignore-scripts",
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    candidate.artifact,
  ],
  repository,
);
const licenses = join(resources, "licenses");
mkdirSync(licenses, { recursive: true });
for (const name of ["electron", "react", "react-dom"]) {
  cpSync(join(repository, `node_modules/${name}/LICENSE`), join(licenses, `${name}.txt`));
}
cpSync(join(electron, "LICENSES.chromium.html"), join(licenses, "chromium.html"));
cpSync(
  join(repository, "apps/desktop/renderer/OPENBOT-LICENSE.txt"),
  join(licenses, "openbot.txt"),
);
cpSync(join(repository, "THIRD_PARTY_NOTICES.md"), join(licenses, "moyyi-notices.md"));
const plist = join(app, "Contents/Info.plist");
for (const [key, value] of [
  ["CFBundleName", "moyyi"],
  ["CFBundleDisplayName", "moyyi"],
  ["CFBundleIdentifier", "org.peerframe.moyyi"],
  ["CFBundleExecutable", "Moyyi"],
  ["CFBundleShortVersionString", "0.0.0"],
  ["CFBundleVersion", "0.0.0"],
]) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], { stdio: "pipe" });
}
renameSync(join(app, "Contents/MacOS/Electron"), join(app, "Contents/MacOS/Moyyi"));
const manifest = {
  format: 1,
  platform: "darwin-arm64",
  version: "0.0.0",
  publicRelease: false,
  electron: "45.0.0",
  react: "19.3.1",
  node: nodeVersion,
  nodeArchiveSha256: nodeSha256,
  runtime: candidate,
  keychainHelperSourceSha256: createHash("sha256")
    .update(readFileSync(join(repository, "apps/desktop/native/keychain.swift")))
    .digest("hex"),
  desktopBundleSha256: createHash("sha256")
    .update(
      Buffer.concat(
        readdirSync(join(output, "app"))
          .sort()
          .flatMap((name) => [Buffer.from(name), readFileSync(join(output, "app", name))]),
      ),
    )
    .digest("hex"),
};
writeFileSync(join(resources, "candidate.json"), `${JSON.stringify(manifest, null, 2)}\n`);
command(
  "/usr/bin/codesign",
  [
    "--force",
    "--deep",
    "--preserve-metadata=entitlements,requirements,flags,runtime",
    "--sign",
    "-",
    app,
  ],
  repository,
);
command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], repository);
const archivePath = join(output, "Moyyi-local-arm64.zip");
rmSync(archivePath, { force: true });
command(
  "/usr/bin/ditto",
  ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archivePath],
  repository,
);
const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(
  `${archivePath}.json`,
  `${JSON.stringify({ ...manifest, app, archivePath, sha256 }, null, 2)}\n`,
);
console.log(JSON.stringify({ app, archivePath, sha256, runtime: candidate.artifact }, null, 2));
