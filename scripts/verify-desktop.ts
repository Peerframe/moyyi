import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pdfBytes } from "../src/runtime/fixtures/document-fixtures.ts";

// Verifies an existing bundle. Packaging is deliberately a separate operation owned by its caller.
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
assert(process.argv.length <= 3, "Usage: node scripts/verify-desktop.ts [Moyyi.app]");
const repository = resolve(import.meta.dirname, "..");
const source = resolve(process.argv[2] ?? join(repository, "artifacts/desktop/Moyyi.app"));
assert(
  existsSync(join(source, "Contents/Resources/app/host.mjs")),
  "Rebuild the desktop bundle: the production host.mjs is missing",
);
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-desktop-installed-")));
try {
  const app = join(temporary, "Moyyi.app");
  execFileSync("/usr/bin/ditto", [source, app], { timeout: 180_000 });
  const resources = join(app, "Contents/Resources");
  const appDirectory = join(resources, "app");
  const node = join(resources, "node/bin/node");
  const home = join(temporary, "verification-home");
  mkdirSync(home);
  const env = { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" };
  const run = (file: string, args: readonly string[]) =>
    execFileSync(file, [...args], {
      cwd: appDirectory,
      env,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const manifest = JSON.parse(readFileSync(join(resources, "candidate.json"), "utf8"));
  const desktopBundleSha256 = createHash("sha256")
    .update(
      Buffer.concat(
        readdirSync(appDirectory)
          .filter((name) => name !== "node_modules")
          .sort()
          .flatMap((name) => [Buffer.from(name), readFileSync(join(appDirectory, name))]),
      ),
    )
    .digest("hex");
  assert.equal(
    desktopBundleSha256,
    manifest.desktopBundleSha256,
    "Installed application bytes do not match their candidate manifest",
  );
  assert.equal(manifest.node, "26.12.1");
  assert.equal(manifest.publicRelease, false);
  assert.equal(run(node, ["--version"]).trim(), "v26.12.1");
  assert(!existsSync(join(appDirectory, "node_modules/moyyi/src")));
  for (const dependency of ["typescript", "vitest", "electron", "@biomejs"]) {
    assert(
      !existsSync(join(appDirectory, "node_modules", dependency)),
      "The installed runtime must not depend on contributor tools",
    );
  }
  for (const license of [
    "openbot.txt",
    "electron.txt",
    "react.txt",
    "react-dom.txt",
    "chromium.html",
    "moyyi-notices.md",
  ]) {
    assert(readFileSync(join(resources, "licenses", license)).length > 0);
  }
  assert(readFileSync(join(resources, "node/LICENSE")).length > 0);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);

  const fixture = join(appDirectory, ".verification");
  mkdirSync(fixture);
  copyFileSync(join(repository, "scripts/desktop-fixtures/host.mjs"), join(fixture, "host.mjs"));
  for (const name of ["document-confinement.mjs", "document-confinement-runner.mjs"]) {
    copyFileSync(join(repository, "scripts/package-fixtures", name), join(fixture, name));
  }
  const workspace = join(temporary, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "note.txt"), "INSTALLED_NOTE_CANARY\n");
  writeFileSync(join(workspace, "sample.pdf"), pdfBytes("INSTALLED_PDF_CANARY"));
  const host = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "host.mjs"),
      workspace,
      join(temporary, "private"),
      join(temporary, "worker-home"),
    ]),
  );
  assert.equal(host.passed, true);
  assert.equal(host.count, 7);
  assert.equal(host.liveModel, false);
  assert.equal(host.credentialReads, 0);
  const confinement = JSON.parse(
    run(node, ["--no-experimental-strip-types", join(fixture, "document-confinement-runner.mjs")]),
  );
  assert.equal(confinement.passed, true);
  assert.equal(confinement.networkDenied, true);
  assert.equal(confinement.deniedNeighborAndCredentials, true);
  assert.equal(confinement.cleanEnvironment, true);
  assert.equal(confinement.liveModel, false);
  console.log(
    JSON.stringify(
      {
        passed: true,
        liveModel: false,
        scope: "installed process/runtime/document probe; Electron UI is verified separately",
        node: manifest.node,
        sourceBundle: source,
        desktopBundleSha256,
        runtime: manifest.runtime,
        host,
        confinement,
        outsideCheckout: true,
        temporaryCopyRemoved: true,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
