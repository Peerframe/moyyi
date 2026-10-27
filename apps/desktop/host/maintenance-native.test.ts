import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRollback } from "./maintenance-rollback.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const currentRevision = "a".repeat(40),
  previousRevision = "6eb299340768daf807edf5b223a84f046a16b140";
function application(path: string, revision: string) {
  const contents = join(path, "Contents");
  const resources = join(contents, "Resources");
  const code = join(resources, "app");
  mkdirSync(code, { recursive: true });
  mkdirSync(join(contents, "MacOS"));
  copyFileSync("/usr/bin/true", join(contents, "MacOS/Moyyi"));
  chmodSync(join(contents, "MacOS/Moyyi"), 0o755);
  writeFileSync(
    join(contents, "Info.plist"),
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Moyyi</string><key>CFBundleIdentifier</key><string>org.peerframe.moyyi.maintenance-fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
  );
  writeFileSync(join(code, "main.mjs"), revision);
  const candidate = {
    format: 1,
    platform: "darwin-arm64",
    publicRelease: false,
    node: "26.12.1",
    desktopBundleSha256: sha(`main.mjs${revision}`),
    runtime: { revision, sha256: sha(revision), dirty: false },
  };
  writeFileSync(join(resources, "candidate.json"), JSON.stringify(candidate));
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", path], { stdio: "pipe" });
  return candidate;
}
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "native maintenance archive boundary (synthetic signed apps)",
  () => {
    it("verifies the actual archive/tree/signature under Seatbelt and cancels without launching", async () => {
      const home = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-native-maint-")));
      roots.push(home);
      const root = join(home, ".moyyi"),
        backup = join(root, "backups/previous"),
        packages = join(root, "packages"),
        data = join(root, "deepseek-data");
      for (const path of [
        backup,
        packages,
        data,
        join(root, "desktop"),
        join(home, "Applications"),
      ])
        mkdirSync(path, { recursive: true, mode: 0o700 });
      const target = join(home, "Applications/Moyyi.app");
      const previousApp = join(backup, "Moyyi.app");
      const current = application(target, currentRevision),
        previous = application(previousApp, previousRevision);
      const archivePath = join(packages, "previous.zip");
      execFileSync("/usr/bin/ditto", [
        "-c",
        "-k",
        "--sequesterRsrc",
        "--keepParent",
        previousApp,
        archivePath,
      ]);
      writeFileSync(
        join(root, "desktop-installation.json"),
        JSON.stringify({
          ...current,
          app: target,
          sourceHead: currentRevision,
          backup,
          nativeLaunchVerified: true,
          historyReopenVerified: true,
          previousDesktop: {
            ...previous,
            app: target,
            sourceHead: previousRevision,
            nativeLaunchVerified: true,
            historyReopenVerified: true,
            archivePath,
            sha256: sha(readFileSync(archivePath)),
          },
        }),
        { mode: 0o600 },
      );
      writeFileSync(
        join(root, "desktop/settings.json"),
        JSON.stringify({
          format: 1,
          settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
          credentials: {},
        }),
        { mode: 0o600 },
      );
      const db = new DatabaseSync(join(data, "data.sqlite"));
      db.exec(
        "PRAGMA application_id=1297045849; PRAGMA user_version=2; CREATE TABLE metadata(key TEXT,value INTEGER); INSERT INTO metadata VALUES('persisted_format',1)",
      );
      db.close();
      new DatabaseSync(join(data, "writer-lock.sqlite")).close();
      const canary = join(home, "canary.txt");
      writeFileSync(canary, "UNCHANGED");
      const prepared = await prepareRollback(home, currentRevision);
      prepared.abort();
      expect(JSON.parse(readFileSync(prepared.result.path, "utf8")).state).toBe("cancelled");
      expect(readFileSync(canary, "utf8")).toBe("UNCHANGED");
      expect(
        JSON.parse(readFileSync(join(target, "Contents/Resources/candidate.json"), "utf8")).runtime
          .revision,
      ).toBe(currentRevision);
    });
  },
);
