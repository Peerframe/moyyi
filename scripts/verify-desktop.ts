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
  assert(
    existsSync(join(resources, "keychain-helper")),
    "Installed native credential helper is required",
  );
  assert.equal(
    manifest.keychainHelperSourceSha256,
    createHash("sha256")
      .update(readFileSync(join(repository, "apps/desktop/native/keychain.swift")))
      .digest("hex"),
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
  for (const name of [
    "host.mjs",
    "host-m2.mjs",
    "host-m3.mjs",
    "host-m5.mjs",
    "host-m6.mjs",
    "material-cancel.mjs",
    "production-settings.mjs",
    "kimi-errors.mjs",
    "phase-deadline.mjs",
    "maintenance.mjs",
  ]) {
    copyFileSync(join(repository, "scripts/desktop-fixtures", name), join(fixture, name));
  }
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
  const documentsWorkspace = join(temporary, "documents-workspace");
  mkdirSync(documentsWorkspace);
  for (const name of [
    "aster.pdf",
    "birch.docx",
    "cedar.xlsx",
    "dahlia.pptx",
    "elm.odt",
    "fir.ods",
    "ginkgo.odp",
  ]) {
    copyFileSync(
      join(repository, "src/runtime/fixtures/documents/standard/eval", name),
      join(documentsWorkspace, name),
    );
  }
  const materialsAndReports = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "host-m2.mjs"),
      documentsWorkspace,
      join(temporary, "m2-private"),
    ]),
  );
  assert.equal(materialsAndReports.passed, true);
  assert.equal(materialsAndReports.count, 7);
  assert.equal(materialsAndReports.cases.length, materialsAndReports.count);
  assert.equal(materialsAndReports.syntheticRequests, 7);
  assert.equal(materialsAndReports.credentialReads, 0);
  assert.equal(materialsAndReports.liveModel, false);
  const externalMaterials = join(temporary, "external-materials");
  const importedWorkspace = join(temporary, "imported-workspace");
  mkdirSync(externalMaterials);
  mkdirSync(importedWorkspace);
  for (const name of [
    "aster.pdf",
    "birch.docx",
    "cedar.xlsx",
    "dahlia.pptx",
    "elm.odt",
    "fir.ods",
    "ginkgo.odp",
  ])
    copyFileSync(
      join(repository, "src/runtime/fixtures/documents/standard/eval", name),
      join(externalMaterials, name),
    );
  const importedMaterialsAndHistory = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "host-m6.mjs"),
      externalMaterials,
      importedWorkspace,
      join(temporary, "m6-private"),
    ]),
  );
  assert.equal(importedMaterialsAndHistory.passed, true);
  assert.equal(importedMaterialsAndHistory.count, 7);
  assert.equal(importedMaterialsAndHistory.cases.length, importedMaterialsAndHistory.count);
  assert.equal(importedMaterialsAndHistory.syntheticRequests, 4);
  assert.equal(importedMaterialsAndHistory.automaticRetries, 0);
  assert.equal(importedMaterialsAndHistory.timeoutMs, 120_000);
  assert.equal(importedMaterialsAndHistory.maxOutputTokens, 8192);
  assert.equal(importedMaterialsAndHistory.credentialReads, 0);
  assert.equal(importedMaterialsAndHistory.networkAttempts, 0);
  assert.equal(importedMaterialsAndHistory.liveModel, false);
  const cancelWorkspace = join(temporary, "cancel-workspace");
  const cancelSources = join(temporary, "cancel-sources");
  mkdirSync(cancelWorkspace);
  mkdirSync(cancelSources);
  const materialCancellation = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "material-cancel.mjs"),
      cancelWorkspace,
      cancelSources,
      join(temporary, "cancel-worker-home"),
    ]),
  );
  assert.equal(materialCancellation.passed, true);
  assert.equal(materialCancellation.actualProductionWorker, true);
  assert.equal(materialCancellation.actualDesktopProcess, true);
  assert.equal(materialCancellation.cancelled, true);
  assert.equal(materialCancellation.modelRequests, 0);
  assert.equal(materialCancellation.credentialReads, 0);
  assert.equal(materialCancellation.credentialWrites, 0);
  assert.equal(materialCancellation.networkAttempts, 0);
  assert.equal(materialCancellation.liveModel, false);
  const changesWorkspace = join(temporary, "changes-workspace");
  mkdirSync(changesWorkspace);
  const editsAndRecovery = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "host-m3.mjs"),
      changesWorkspace,
      join(temporary, "m3-private"),
    ]),
  );
  assert.equal(editsAndRecovery.passed, true);
  assert.equal(editsAndRecovery.count, 10);
  assert.equal(editsAndRecovery.cases.length, editsAndRecovery.count);
  assert.equal(editsAndRecovery.syntheticRequests, 33);
  assert.equal(editsAndRecovery.credentialReads, 0);
  assert.equal(editsAndRecovery.networkAttempts, 0);
  assert.equal(editsAndRecovery.liveModel, false);
  const webWorkspace = join(temporary, "web-workspace");
  mkdirSync(webWorkspace);
  const webSources = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "host-m5.mjs"),
      webWorkspace,
      join(temporary, "m5-private"),
    ]),
  );
  assert.equal(webSources.passed, true);
  assert.equal(webSources.count, 5);
  assert.equal(webSources.cases.length, webSources.count);
  assert.equal(webSources.syntheticRequests, 10);
  assert.equal(webSources.syntheticDns, 2);
  assert.equal(webSources.syntheticHttp, 2);
  assert.equal(webSources.credentialReads, 0);
  assert.equal(webSources.networkAttempts, 0);
  assert.equal(webSources.liveModel, false);
  const settingsWorkspace = join(temporary, "settings-workspace");
  mkdirSync(settingsWorkspace);
  const productionSettings = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "production-settings.mjs"),
      settingsWorkspace,
      join(temporary, "settings-worker-home"),
    ]),
  );
  assert.equal(productionSettings.passed, true);
  assert.equal(productionSettings.count, 8);
  assert.equal(productionSettings.cases.length, productionSettings.count);
  assert.equal(productionSettings.savedMaxRequests, 4);
  assert.equal(productionSettings.restoredMaxRequests, 4);
  assert.equal(productionSettings.credentialReads, 0);
  assert.equal(productionSettings.credentialWrites, 0);
  assert.equal(productionSettings.networkAttempts, 0);
  assert.equal(productionSettings.liveModel, false);
  const kimiErrors = JSON.parse(
    run(node, ["--no-experimental-strip-types", join(fixture, "kimi-errors.mjs")]),
  );
  assert.equal(kimiErrors.passed, true);
  assert.equal(kimiErrors.count, 4);
  assert.equal(kimiErrors.cases.length, kimiErrors.count);
  assert.equal(kimiErrors.syntheticRequests, 4);
  assert.equal(kimiErrors.credentialReads, 0);
  assert.equal(kimiErrors.networkAttempts, 0);
  assert.equal(kimiErrors.toolExecutions, 0);
  assert.equal(kimiErrors.automaticRetries, 0);
  assert.equal(kimiErrors.liveModel, false);
  const phaseDeadline = JSON.parse(
    run(node, ["--no-experimental-strip-types", join(fixture, "phase-deadline.mjs")]),
  );
  assert.equal(phaseDeadline.passed, true);
  assert.equal(phaseDeadline.syntheticRequests, 3);
  assert.equal(phaseDeadline.investigationMs, 100_000);
  assert.equal(phaseDeadline.elapsedMs, 150_000);
  assert.equal(phaseDeadline.timeoutMs, 300_000);
  assert.equal(phaseDeadline.networkAttempts, 0);
  assert.equal(phaseDeadline.automaticRetries, 0);
  assert.equal(phaseDeadline.liveModel, false);
  const maintenanceWorkspace = join(temporary, "maintenance-workspace");
  mkdirSync(maintenanceWorkspace);
  const maintenance = JSON.parse(
    run(node, [
      "--no-experimental-strip-types",
      join(fixture, "maintenance.mjs"),
      join(temporary, "maintenance-home"),
      maintenanceWorkspace,
    ]),
  );
  assert.equal(maintenance.passed, true);
  assert.equal(maintenance.cases.length, 7);
  assert.equal(maintenance.seedSyntheticModelRequests, 1);
  assert.equal(maintenance.maintenanceModelRequests, 0);
  assert.equal(maintenance.credentialReads, 0);
  assert.equal(maintenance.helperNativeCalls, 0);
  assert.equal(maintenance.helperNetworkAttempts, 0);
  assert.equal(maintenance.workspaceUnchanged, true);
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
        materialsAndReports,
        importedMaterialsAndHistory,
        materialCancellation,
        editsAndRecovery,
        productionSettings,
        webSources,
        kimiErrors,
        phaseDeadline,
        maintenance,
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
