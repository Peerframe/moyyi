import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  hashFile,
  type MaintenanceResult,
  preserved,
  privateDirectory,
  readPrivateFile,
  syncFolder,
  writePrivateJson,
} from "./maintenance.ts";

// These local-only candidates passed their recorded package/installation gates. A matching
// ad-hoc signature alone never makes an arbitrary application an accepted rollback target.
const legacyRevisions = new Set([
  "6eb299340768daf807edf5b223a84f046a16b140",
  "3220f2f3d6a0b1786bdfd75c1efb708034c7f8e7",
]);
interface Installation {
  app: string;
  sourceHead: string;
  archivePath: string;
  sha256: string;
  backup: string;
  previousDesktop?: Installation;
  nativeLaunchVerified?: boolean;
  historyReopenVerified?: boolean;
  desktopBundleSha256: string;
  runtime: { revision: string; sha256: string; dirty: boolean };
}
interface Candidate {
  format: number;
  platform: string;
  publicRelease: boolean;
  node: string;
  desktopBundleSha256: string;
  runtime: { revision: string; sha256: string; dirty: boolean };
  maintenanceCompatibility?: {
    schemaVersion: number;
    persistedFormat: number;
    settingsFormat: number;
    settingsKeys: string[];
  };
}
export interface PreparedRollback {
  readonly result: MaintenanceResult;
  readonly commit: () => Promise<MaintenanceResult>;
  readonly abort: () => void;
}
const execute = (file: string, args: string[]) =>
  execFileSync(file, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { PATH: "/usr/bin:/bin" },
  });

function childOf(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return !!rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}
function candidate(app: string, installation: Installation): Candidate {
  const value = JSON.parse(
    readPrivateFile(join(app, "Contents/Resources/candidate.json"), 65_536).toString("utf8"),
  ) as Candidate;
  if (
    value.format !== 1 ||
    value.platform !== "darwin-arm64" ||
    value.publicRelease !== false ||
    value.node !== "26.12.1" ||
    value.runtime?.revision !== installation.sourceHead ||
    value.desktopBundleSha256 !== installation.desktopBundleSha256 ||
    value.runtime.sha256 !== installation.runtime?.sha256 ||
    installation.runtime?.revision !== installation.sourceHead ||
    value.runtime.dirty !== false ||
    !/^[a-f0-9]{64}$/.test(value.desktopBundleSha256)
  )
    throw Error("Rollback candidate identity mismatch");
  const appRoot = join(app, "Contents/Resources/app");
  const hash = createHash("sha256");
  // This is the exact static bundle digest used by desktop-package.ts; runtime dependencies
  // remain covered by the application's verified code signature and installed archive receipt.
  for (const name of readdirSync(appRoot).sort()) {
    const path = join(appRoot, name);
    if (lstatSync(path).isDirectory()) continue;
    hash.update(name);
    hash.update(readPrivateFile(path, 32 * 1024 * 1024));
  }
  if (hash.digest("hex") !== value.desktopBundleSha256)
    throw Error("Rollback desktop bundle hash mismatch");
  execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  return value;
}
function tree(root: string, directory = ""): string[] {
  const rows: string[] = [];
  for (const name of readdirSync(join(root, directory)).sort()) {
    const rel = join(directory, name);
    const path = join(root, rel);
    const stat = lstatSync(path);
    if (stat.uid !== process.getuid?.() || (!stat.isSymbolicLink() && stat.mode & 0o022))
      throw Error("Unsafe application ownership");
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(path);
      if (isAbsolute(link) || !childOf(root, resolve(root, directory, link)))
        throw Error("Application link escapes its bundle");
      rows.push(`${rel}:${stat.mode}:link:${link}`);
    } else if (stat.isDirectory()) {
      rows.push(`${rel}:${stat.mode}:directory`);
      rows.push(...tree(root, rel));
    } else {
      rows.push(`${rel}:${stat.mode}:${hashFile(path).sha256}`);
    }
  }
  return rows;
}
function extractRecordedArchive(archive: string, destination: string): string {
  mkdirSync(destination, { mode: 0o700 });
  const ancestors = new Set<string>();
  for (const path of [archive, destination]) {
    for (let at = dirname(path); ; at = dirname(at)) {
      ancestors.add(at);
      if (dirname(at) === at) break;
    }
  }
  const literal = [
    ...ancestors,
    archive,
    "/usr/bin/ditto",
    "/dev/null",
    "/dev/urandom",
    "/dev/random",
  ]
    .map((path) => `(literal ${JSON.stringify(path)})`)
    .join(" ");
  const profile = [
    "(version 1)",
    "(deny default)",
    '(allow process-exec (literal "/usr/bin/ditto"))',
    "(allow signal (target same-sandbox))",
    "(allow process-info* (target same-sandbox))",
    '(allow sysctl-read (sysctl-name "hw.machine") (sysctl-name "kern.osrelease") (sysctl-name "kern.osversion") (sysctl-name "kern.version"))',
    `(allow file-read* ${literal} (subpath "/System") (subpath "/usr/lib"))`,
    `(allow file-read* file-write* (subpath ${JSON.stringify(destination)}))`,
    '(allow file-write-data (literal "/dev/null"))',
  ].join("\n");
  execute("/usr/bin/sandbox-exec", [
    "-p",
    profile,
    "/usr/bin/ditto",
    "-x",
    "-k",
    archive,
    destination,
  ]);
  if (readdirSync(destination).join() !== "Moyyi.app")
    throw Error("Recorded archive has unexpected top-level files");
  return join(destination, "Moyyi.app");
}

function preserveDirectoryModes(source: string, target: string): void {
  chmodSync(target, lstatSync(source).mode & 0o777);
  for (const name of readdirSync(source)) {
    const stat = lstatSync(join(source, name));
    if (stat.isDirectory()) preserveDirectoryModes(join(source, name), join(target, name));
  }
}

async function compatibility(home: string, target: Candidate): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(home, ".moyyi/deepseek-data/data.sqlite"), { readOnly: true });
  try {
    if (
      db.prepare("PRAGMA application_id").get()?.application_id !== 0x4d4f5959 ||
      db.prepare("PRAGMA user_version").get()?.user_version !== 2 ||
      db.prepare("SELECT value FROM metadata WHERE key='persisted_format'").get()?.value !== 1
    )
      throw Error("Rollback cannot read the current data format");
  } finally {
    db.close();
  }
  const settings = JSON.parse(
    readPrivateFile(join(home, ".moyyi/desktop/settings.json"), 16_384).toString("utf8"),
  ) as { format: number; settings: Record<string, unknown> };
  const legacy = legacyRevisions.has(target.runtime.revision);
  const declared = target.maintenanceCompatibility;
  if (
    !legacy &&
    (declared?.schemaVersion !== 2 ||
      declared.persistedFormat !== 1 ||
      declared.settingsFormat !== 1 ||
      !Array.isArray(declared.settingsKeys))
  )
    throw Error("Rollback compatibility is not recorded");
  const allowed = legacy ? ["maxRequests", "preset", "timeoutMs"] : (declared?.settingsKeys ?? []);
  if (
    allowed.some(
      (key) =>
        !["maxRequests", "preset", "timeoutMs", "kimiReasoningEffort", "evidenceAnswer"].includes(
          key,
        ),
    ) ||
    settings.format !== 1 ||
    !settings.settings ||
    Object.keys(settings.settings).some((key) => !allowed.includes(key))
  )
    throw Error(
      "ROLLBACK_SETTINGS: 请先在模型设置中切回 Flash 并保存，再回退软件；当前设置不会被自动修改。",
    );
}

async function holdWriterLock(home: string): Promise<() => void> {
  const { DatabaseSync } = await import("node:sqlite");
  const data = privateDirectory(join(home, ".moyyi/deepseek-data"));
  const path = join(data, "writer-lock.sqlite");
  // Match the store's existing lock protocol. Never open/close the lock through fs descriptors.
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error("Unsafe writer lock");
  const lock = new DatabaseSync(path, { timeout: 0 });
  try {
    lock.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    lock.close();
    throw error;
  }
  let held = true;
  return () => {
    if (held) {
      held = false;
      lock.close();
    }
  };
}

/** Prepare only. Commit is permitted by the worker solely after arm ACK and parent exit. */
export async function prepareRollback(
  home: string,
  expectedCurrentRevision: string,
): Promise<PreparedRollback> {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("Rollback supports macOS arm64 only");
  const root = privateDirectory(join(home, ".moyyi"));
  const receiptPath = join(root, "desktop-installation.json");
  const receiptBytes = readPrivateFile(receiptPath, 256 * 1024);
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as Installation;
  const previous = receipt.previousDesktop;
  const target = join(privateDirectory(join(home, "Applications")), "Moyyi.app");
  if (
    !previous ||
    receipt.sourceHead !== expectedCurrentRevision ||
    receipt.app !== target ||
    !receipt.nativeLaunchVerified ||
    !receipt.historyReopenVerified ||
    previous.nativeLaunchVerified !== true ||
    previous.historyReopenVerified !== true ||
    !/^[a-f0-9]{40}$/.test(previous.sourceHead) ||
    !/^[a-f0-9]{64}$/.test(previous.sha256)
  )
    throw Error("No verified previous installation is available");
  const backups = privateDirectory(join(root, "backups"));
  const packages = privateDirectory(join(root, "packages"));
  if (!childOf(backups, receipt.backup) || !childOf(packages, previous.archivePath))
    throw Error("Rollback receipt points outside managed storage");
  privateDirectory(receipt.backup);
  if (hashFile(previous.archivePath).sha256 !== previous.sha256)
    throw Error("Previous archive hash mismatch");
  const source = join(receipt.backup, "Moyyi.app");
  privateDirectory(source);
  candidate(target, receipt);
  const previousCandidate = candidate(source, previous);
  const operation = join(backups, `software-rollback-${randomUUID()}`);
  const prepared = join(home, "Applications", `.Moyyi-rollback-${randomUUID()}.app`);
  let committed = false;
  const releaseStore = await holdWriterLock(home);
  try {
    await compatibility(home, previousCandidate);
    mkdirSync(operation, { mode: 0o700 });
    const originalTree = tree(source);
    const extracted = extractRecordedArchive(previous.archivePath, join(operation, "archive"));
    if (
      hashFile(previous.archivePath).sha256 !== previous.sha256 ||
      JSON.stringify(tree(extracted)) !== JSON.stringify(originalTree)
    )
      throw Error("Retained application differs from its recorded archive");
    cpSync(source, prepared, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
    });
    preserveDirectoryModes(source, prepared);
    if (JSON.stringify(tree(prepared)) !== JSON.stringify(originalTree))
      throw Error("Prepared rollback differs from its retained app");
    candidate(prepared, previous);
    const result: MaintenanceResult = {
      kind: "rollback",
      path: join(operation, "result.json"),
      rescuePath: join(operation, "Moyyi.app"),
      sessionCount: null,
      schemaVersion: 2,
      persistedFormat: 1,
      targetRevision: previous.sourceHead,
      ...preserved,
    };
    writePrivateJson(result.path, { state: "prepared", result });
    return {
      result,
      abort() {
        if (committed) return;
        releaseStore();
        rmSync(prepared, { recursive: true, force: true });
        rmSync(join(operation, "archive"), { recursive: true, force: true });
        writePrivateJson(result.path, { state: "cancelled", result });
      },
      async commit() {
        if (committed) throw Error("Rollback was already committed");
        try {
          if (!readPrivateFile(receiptPath, 256 * 1024).equals(receiptBytes))
            throw Error("Installation changed after rollback preparation");
          await compatibility(home, previousCandidate);
          candidate(target, receipt);
          candidate(prepared, previous);
          renameSync(target, join(operation, "Moyyi.app"));
          try {
            renameSync(prepared, target);
          } catch (error) {
            renameSync(join(operation, "Moyyi.app"), target);
            throw error;
          }
          committed = true;
          syncFolder(join(home, "Applications"));
          syncFolder(operation);
          writePrivateJson(receiptPath, {
            ...previous,
            app: target,
            backup: operation,
            previousDesktop: { ...receipt, previousDesktop: undefined },
            nativeLaunchVerified: false,
            historyReopenVerified: false,
            maintenanceRollback: true,
            rolledBackAt: new Date().toISOString(),
          });
          writePrivateJson(result.path, {
            state: "completed",
            result,
            nativeLaunchVerified: false,
          });
        } catch (error) {
          writePrivateJson(result.path, {
            state: "unconfirmed",
            result,
            applicationReplaced: committed,
          });
          throw error;
        } finally {
          releaseStore();
          // Return to the retained or restored real app even if commit acknowledgement failed.
          try {
            execute("/usr/bin/open", ["-n", "--env", `HOME=${home}`, target]);
          } catch {
            /* The receipt does not claim native launch success. */
          }
        }
        return result;
      },
    };
  } catch (error) {
    releaseStore();
    rmSync(prepared, { recursive: true, force: true });
    rmSync(operation, { recursive: true, force: true });
    throw error;
  }
}
