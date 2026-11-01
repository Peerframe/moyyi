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
interface StoreVersion {
  readonly schemaVersion: number;
  readonly persistedFormat: number;
  readonly settingsFormat?: 1 | 2;
}
function app(path: string, revision: string, version?: StoreVersion) {
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
      ...(version
        ? {
            maintenanceCompatibility: {
              ...version,
              settingsFormat: version.settingsFormat ?? 1,
              settingsKeys: [
                "preset",
                "maxRequests",
                "timeoutMs",
                "kimiReasoningEffort",
                "evidenceAnswer",
              ],
            },
          }
        : {}),
    }),
  );
}
function fixture(high = false, versions?: { data: StoreVersion; target: StoreVersion }) {
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
  const previous = versions ? "b".repeat(40) : previousRevision;
  app(target, currentRevision, versions?.data);
  app(join(backup, "Moyyi.app"), previous, versions?.target);
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
      sourceHead: previous,
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
  if (versions) {
    db.exec(`PRAGMA user_version=${versions.data.schemaVersion}`);
    db.prepare("UPDATE metadata SET value=?").run(versions.data.persistedFormat);
  }
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
  return { home, root, target, data, archive, receiptPath, settingsPath, previous };
}

function upgradeSettings(path: string): Buffer {
  const bytes = Buffer.from(
    JSON.stringify({
      format: 2,
      settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
      connections: [
        {
          id: "research",
          name: "Research",
          provider: "deepseek",
          reasoningEffort: "low",
          credentialRef: "desktop:11111111-1111-4111-8111-111111111111",
        },
      ],
      activeConnectionId: "research",
      searchConnectionId: "research",
      personalInstructionsHash: null,
      skills: [],
    }),
  );
  writeFileSync(path, bytes);
  return bytes;
}

describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "software rollback coordination (native calls mocked)",
  () => {
    it("refuses settings format 2 with format-1 software without discarding current connections", async () => {
      const version = { schemaVersion: 3, persistedFormat: 2 };
      const f = fixture(false, { data: version, target: version });
      const settings = upgradeSettings(f.settingsPath);
      const installed = readFileSync(join(f.target, "Contents/Resources/candidate.json"));
      await expect(prepareRollback(f.home, currentRevision)).rejects.toThrow("升级前设置备份");
      expect(readFileSync(f.settingsPath)).toEqual(settings);
      expect(readFileSync(join(f.target, "Contents/Resources/candidate.json"))).toEqual(installed);
    });

    it.each([1, 2])(
      "allows settings format %i with software that declares format 2",
      async (format) => {
        const version = { schemaVersion: 3, persistedFormat: 2, settingsFormat: 2 as const };
        const f = fixture(false, { data: version, target: version });
        if (format === 2) upgradeSettings(f.settingsPath);
        const settings = readFileSync(f.settingsPath);
        const prepared = await prepareRollback(f.home, currentRevision);
        await prepared.commit();
        expect(readFileSync(f.settingsPath)).toEqual(settings);
      },
    );

    it("rechecks settings format before replacing software after preparation", async () => {
      const version = { schemaVersion: 3, persistedFormat: 2 };
      const f = fixture(false, { data: version, target: version });
      const prepared = await prepareRollback(f.home, currentRevision);
      const installed = readFileSync(join(f.target, "Contents/Resources/candidate.json"));
      const settings = upgradeSettings(f.settingsPath);
      await expect(prepared.commit()).rejects.toThrow("ROLLBACK_SETTINGS");
      expect(readFileSync(f.settingsPath)).toEqual(settings);
      expect(readFileSync(join(f.target, "Contents/Resources/candidate.json"))).toEqual(installed);
      prepared.abort();
    });

    it("retains format-2 data and reports its actual format when the target matches", async () => {
      const version = { schemaVersion: 3, persistedFormat: 2 };
      const f = fixture(false, { data: version, target: version });
      const before = readFileSync(join(f.data, "data.sqlite"));
      const prepared = await prepareRollback(f.home, currentRevision);
      expect(prepared.result).toMatchObject(version);
      const result = await prepared.commit();
      expect(result).toMatchObject({ ...version, targetRevision: f.previous });
      expect(readFileSync(join(f.data, "data.sqlite"))).toEqual(before);
      expect(existsSync(result.rescuePath as string)).toBe(true);
    });

    it.each([
      [2, 1],
      [1, 2],
    ])(
      "refuses same-schema format %i data with format %i software",
      async (dataFormat, targetFormat) => {
        const f = fixture(false, {
          data: { schemaVersion: 3, persistedFormat: dataFormat },
          target: { schemaVersion: 3, persistedFormat: targetFormat },
        });
        const data = readFileSync(join(f.data, "data.sqlite"));
        const installed = readFileSync(join(f.target, "Contents/Resources/candidate.json"));
        await expect(prepareRollback(f.home, currentRevision)).rejects.toThrow("ROLLBACK_DATA");
        expect(readFileSync(join(f.data, "data.sqlite"))).toEqual(data);
        expect(readFileSync(join(f.target, "Contents/Resources/candidate.json"))).toEqual(
          installed,
        );
      },
    );

    it.each([
      { schemaVersion: 2, persistedFormat: 2 },
      { schemaVersion: 3, persistedFormat: 3 },
    ])("rejects unsupported current or declared version pairs %j", async (version) => {
      const current = fixture(false, {
        data: version,
        target: { schemaVersion: 3, persistedFormat: 2 },
      });
      await expect(prepareRollback(current.home, currentRevision)).rejects.toThrow(
        "current data format",
      );
      const target = fixture(false, {
        data: { schemaVersion: 3, persistedFormat: 2 },
        target: version,
      });
      await expect(prepareRollback(target.home, currentRevision)).rejects.toThrow(
        "compatibility is not recorded",
      );
    });

    it("rechecks the persisted format after preparation before replacing software", async () => {
      const version = { schemaVersion: 3, persistedFormat: 1 };
      const f = fixture(false, { data: version, target: version });
      const prepared = await prepareRollback(f.home, currentRevision);
      const installed = readFileSync(join(f.target, "Contents/Resources/candidate.json"));
      const db = new DatabaseSync(join(f.data, "data.sqlite"));
      db.exec("UPDATE metadata SET value=2");
      db.close();
      await expect(prepared.commit()).rejects.toThrow("ROLLBACK_DATA");
      expect(readFileSync(join(f.target, "Contents/Resources/candidate.json"))).toEqual(installed);
      prepared.abort();
    });

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
