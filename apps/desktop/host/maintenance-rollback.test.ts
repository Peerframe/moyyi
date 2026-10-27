import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareRollback } from "./maintenance-rollback.ts";

const native = vi.hoisted(() => vi.fn((_file: string, _args: readonly string[]) => ""));
vi.mock("node:child_process", () => ({ execFileSync: native, execFile: vi.fn(), spawn: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  native.mockClear();
});
const currentRevision = "a".repeat(40);
const previousRevision = "6eb299340768daf807edf5b223a84f046a16b140";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function app(path: string, revision: string) {
  const resources = join(path, "Contents/Resources");
  const directory = join(resources, "app");
  mkdirSync(directory, { recursive: true, mode: 0o755 });
  const contents = `export const revision = '${revision}';`;
  writeFileSync(join(directory, "main.mjs"), contents);
  writeFileSync(
    join(resources, "candidate.json"),
    JSON.stringify({
      format: 1,
      platform: "darwin-arm64",
      publicRelease: false,
      node: "26.12.1",
      desktopBundleSha256: sha(`main.mjs${contents}`),
      runtime: { revision, dirty: false, sha256: sha(revision) },
    }),
  );
}
function fixture(high = false) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-rollback-")));
  roots.push(home);
  const root = join(home, ".moyyi");
  const backup = join(root, "backups/previous");
  const packages = join(root, "packages");
  const desktop = join(root, "desktop");
  const data = join(root, "deepseek-data");
  for (const path of [backup, packages, desktop, data, join(home, "Applications")])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  const target = join(home, "Applications/Moyyi.app");
  app(target, currentRevision);
  app(join(backup, "Moyyi.app"), previousRevision);
  const archive = join(packages, "previous.zip");
  writeFileSync(archive, "synthetic archive");
  const receiptPath = join(root, "desktop-installation.json");
  const receipt = {
    ...JSON.parse(readFileSync(join(target, "Contents/Resources/candidate.json"), "utf8")),
    app: target,
    sourceHead: currentRevision,
    backup,
    nativeLaunchVerified: true,
    historyReopenVerified: true,
    previousDesktop: {
      ...JSON.parse(
        readFileSync(join(backup, "Moyyi.app/Contents/Resources/candidate.json"), "utf8"),
      ),
      app: target,
      sourceHead: previousRevision,
      nativeLaunchVerified: true,
      historyReopenVerified: true,
      archivePath: archive,
      sha256: sha("synthetic archive"),
    },
  };
  writeFileSync(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  const settingsPath = join(desktop, "settings.json");
  writeFileSync(
    settingsPath,
    JSON.stringify({
      format: 1,
      settings: {
        preset: high ? "kimi-cn" : "flash",
        maxRequests: 3,
        timeoutMs: 120000,
        ...(high ? { kimiReasoningEffort: "high" } : {}),
      },
      credentials: {},
    }),
    { mode: 0o600 },
  );
  const db = new DatabaseSync(join(data, "data.sqlite"));
  db.exec(
    "PRAGMA application_id=1297045849; PRAGMA user_version=2; CREATE TABLE metadata(key TEXT,value INTEGER); INSERT INTO metadata VALUES('persisted_format',1)",
  );
  db.close();
  const lock = new DatabaseSync(join(data, "writer-lock.sqlite"));
  lock.close();
  native.mockImplementation((file, args) => {
    if (file === "/usr/bin/sandbox-exec") {
      const destination = args.at(-1);
      if (!destination) throw Error("Missing extraction target");
      cpSync(join(backup, "Moyyi.app"), join(destination, "Moyyi.app"), { recursive: true });
    }
    return "";
  });
  return { home, root, target, data, archive, receiptPath, settingsPath };
}

describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "software rollback coordination (native calls mocked)",
  () => {
    it("holds the existing store lock while prepared and cancels without replacing the app", async () => {
      const f = fixture();
      const before = readFileSync(join(f.target, "Contents/Resources/candidate.json"));
      const prepared = await prepareRollback(f.home, currentRevision);
      const contender = new DatabaseSync(join(f.data, "writer-lock.sqlite"), { timeout: 0 });
      try {
        expect(() => contender.exec("BEGIN EXCLUSIVE")).toThrow();
      } finally {
        contender.close();
      }
      prepared.abort();
      expect(readFileSync(join(f.target, "Contents/Resources/candidate.json"))).toEqual(before);
      expect(JSON.parse(readFileSync(prepared.result.path, "utf8")).state).toBe("cancelled");
      expect(native.mock.calls.some((args) => args[0] === "/usr/bin/open")).toBe(false);
    });
    it("replaces only software, retains current app rescue, and never rolls back data or settings", async () => {
      const f = fixture();
      const data = readFileSync(join(f.data, "data.sqlite"));
      const settings = readFileSync(f.settingsPath);
      const prepared = await prepareRollback(f.home, currentRevision);
      const result = await prepared.commit();
      expect(
        JSON.parse(readFileSync(join(f.target, "Contents/Resources/candidate.json"), "utf8"))
          .runtime.revision,
      ).toBe(previousRevision);
      expect(existsSync(result.rescuePath as string)).toBe(true);
      expect(readFileSync(join(f.data, "data.sqlite"))).toEqual(data);
      expect(readFileSync(f.settingsPath)).toEqual(settings);
      expect(JSON.parse(readFileSync(f.receiptPath, "utf8"))).toMatchObject({
        sourceHead: previousRevision,
        nativeLaunchVerified: false,
        historyReopenVerified: false,
      });
    });
    it("refuses legacy rollback with high settings instead of rewriting them", async () => {
      const f = fixture(true);
      const before = readFileSync(f.settingsPath);
      await expect(prepareRollback(f.home, currentRevision)).rejects.toThrow("切回 Flash");
      expect(readFileSync(f.settingsPath)).toEqual(before);
    });
    it("rejects a changed archive before preparing software", async () => {
      const f = fixture();
      writeFileSync(f.archive, "changed archive");
      await expect(prepareRollback(f.home, currentRevision)).rejects.toThrow("archive hash");
    });
    it("rejects previous versions without both recorded native verification gates", async () => {
      for (const field of ["nativeLaunchVerified", "historyReopenVerified"]) {
        for (const value of [false, undefined]) {
          const f = fixture();
          const receipt = JSON.parse(readFileSync(f.receiptPath, "utf8"));
          receipt.previousDesktop[field] = value;
          writeFileSync(f.receiptPath, JSON.stringify(receipt));
          await expect(prepareRollback(f.home, currentRevision)).rejects.toThrow(
            "No verified previous",
          );
        }
      }
    });
    it("rejects a stale installation receipt at commit", async () => {
      const f = fixture();
      const prepared = await prepareRollback(f.home, currentRevision);
      const before = readFileSync(join(f.target, "Contents/Resources/candidate.json"));
      writeFileSync(f.receiptPath, "changed");
      await expect(prepared.commit()).rejects.toThrow("Installation changed");
      expect(readFileSync(join(f.target, "Contents/Resources/candidate.json"))).toEqual(before);
      prepared.abort();
    });
  },
);
