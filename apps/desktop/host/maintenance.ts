import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isCredentialRef } from "./keychain.ts";
import { parseSettings } from "./settings-schema.ts";

export type MaintenanceRequest =
  | { readonly mode: "backup"; readonly destination: string }
  | { readonly mode: "restore"; readonly backupPath: string }
  | { readonly mode: "rollback"; readonly expectedCurrentRevision: string };
export interface MaintenanceResult {
  readonly kind: "backup" | "restore" | "rollback";
  readonly path: string;
  readonly rescuePath: string | null;
  readonly sessionCount: number | null;
  readonly schemaVersion: number | null;
  readonly persistedFormat: number | null;
  readonly targetRevision: string | null;
  readonly settingsPreserved: true;
  readonly workspacesUntouched: true;
  readonly credentialsExported: false;
}
export type MaintenanceMessage =
  | { readonly type: "ready" }
  | { readonly type: "result"; readonly id: number; readonly result: MaintenanceResult }
  | { readonly type: "prepared"; readonly id: number; readonly result: MaintenanceResult }
  | { readonly type: "armed"; readonly id: number }
  | { readonly type: "error"; readonly id: number; readonly message: string };

interface FileRecord {
  path: string;
  bytes: number;
  sha256: string;
}
interface Manifest {
  format: 1;
  kind: "moyyi-local-backup";
  createdAt: string;
  schemaVersion: number;
  persistedFormat: number;
  sessionCount: number;
  credentialsExported: false;
  files: FileRecord[];
}

export function parseMaintenanceRequest(value: unknown): MaintenanceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid maintenance request");
  const object = value as Record<string, unknown>;
  const field =
    object.mode === "backup"
      ? "destination"
      : object.mode === "restore"
        ? "backupPath"
        : object.mode === "rollback"
          ? "expectedCurrentRevision"
          : "";
  if (!field || Object.keys(object).sort().join() !== ["mode", field].sort().join())
    throw Error("Invalid maintenance request");
  const text = object[field];
  if (
    typeof text !== "string" ||
    !text ||
    text.length > 4096 ||
    text.includes("\0") ||
    (object.mode === "rollback" ? !/^[a-f0-9]{40}$/.test(text) : !isAbsolute(text))
  )
    throw Error("Invalid maintenance target");
  return object as unknown as MaintenanceRequest;
}

export function privateDirectory(path: string, create = false): string {
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o022
  )
    throw Error("Unsafe maintenance directory");
  return realpathSync(path);
}

export function readPrivateFile(path: string, maximum = 32 * 1024 * 1024): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o022 ||
      stat.size > maximum
    )
      throw Error("Unsafe maintenance file");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw Error("Maintenance file changed");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function hashFile(path: string): { bytes: number; sha256: string } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o022 ||
      stat.size > 2 * 1024 * 1024 * 1024
    )
      throw Error("Unsafe maintenance file");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let size = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count;
      if (size > stat.size) throw Error("Maintenance file grew");
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(fd);
    if (size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
      throw Error("Maintenance file changed");
    return { bytes: size, sha256: hash.digest("hex") };
  } finally {
    closeSync(fd);
  }
}

export function syncFolder(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function writePrivateJson(path: string, value: unknown): void {
  const temporary = join(dirname(path), `.maintenance-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    syncFolder(dirname(path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function settingsBytes(home: string): Buffer | null {
  const folder = join(home, ".moyyi/desktop");
  try {
    privateDirectory(folder);
    const bytes = readPrivateFile(join(folder, "settings.json"), 16_384);
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (
      value.format !== 1 ||
      Object.keys(value).sort().join() !== "credentials,format,settings" ||
      !value.credentials ||
      typeof value.credentials !== "object" ||
      Array.isArray(value.credentials)
    )
      throw Error("Invalid data-only settings");
    parseSettings(value.settings);
    for (const [key, ref] of Object.entries(value.credentials)) {
      if (
        !["flash", "kimi-cn", "kimi-global"].includes(key) ||
        !isCredentialRef(ref) ||
        (!ref.startsWith("desktop:") && ref !== `legacy-${key}`)
      )
        throw Error("Invalid credential reference");
    }
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function listBackupFiles(root: string): FileRecord[] {
  const paths = [
    "store/data.sqlite",
    ...readdirSync(join(root, "store/blobs")).map((name) => {
      if (!/^[a-f0-9]{64}$/.test(name)) throw Error("Invalid backup blob");
      return `store/blobs/${name}`;
    }),
  ];
  if (readdirSync(root).includes("settings.json")) paths.push("settings.json");
  if (paths.length > 100_002) throw Error("Too many backup files");
  return paths.sort().map((path) => ({ path, ...hashFile(join(root, path)) }));
}

function validateBackup(root: string): Manifest {
  privateDirectory(root);
  const value = JSON.parse(
    readPrivateFile(join(root, "manifest.json")).toString("utf8"),
  ) as Manifest;
  if (
    value.format !== 1 ||
    value.kind !== "moyyi-local-backup" ||
    value.credentialsExported !== false ||
    ![2, 3].includes(value.schemaVersion) ||
    value.persistedFormat !== 1 ||
    !Number.isSafeInteger(value.sessionCount) ||
    value.sessionCount < 0 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.files)
  )
    throw Error("Unsupported backup manifest");
  const top = readdirSync(root).sort().join();
  if (top !== "manifest.json,store" && top !== "manifest.json,settings.json,store")
    throw Error("Unexpected backup files");
  privateDirectory(join(root, "store"));
  privateDirectory(join(root, "store/blobs"));
  if (readdirSync(join(root, "store")).sort().join() !== "blobs,data.sqlite")
    throw Error("Unexpected store files");
  if (JSON.stringify(listBackupFiles(root)) !== JSON.stringify(value.files))
    throw Error("Backup hash verification failed");
  return value;
}

const preserved = {
  settingsPreserved: true,
  workspacesUntouched: true,
  credentialsExported: false,
} as const;

export { preserved };

/** Called only by the separate Node helper after the normal worker has exited. */
export async function runDataMaintenance(
  home: string,
  request: Exclude<MaintenanceRequest, { mode: "rollback" }>,
): Promise<MaintenanceResult> {
  privateDirectory(home);
  const root = privateDirectory(join(home, ".moyyi"));
  const dataDirectory = privateDirectory(join(root, "deepseek-data"));
  const { backupLocalStore, restoreLocalStore } = await import("moyyi/runtime");
  if (request.mode === "backup") {
    const parent = privateDirectory(dirname(resolve(request.destination)));
    const target = join(parent, basename(request.destination));
    const containment = relative(dataDirectory, target);
    if (!(containment === ".." || containment.startsWith("../")))
      throw Error("Backup must be outside the live store");
    try {
      lstatSync(target);
      throw Error("Backup destination already exists");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const staging = join(parent, `.moyyi-backup-${randomUUID()}`);
    mkdirSync(staging, { mode: 0o700 });
    try {
      const settings = settingsBytes(home);
      const receipt = await backupLocalStore({
        dataDirectory,
        destination: join(staging, "store"),
      });
      if (settings)
        writeFileSync(join(staging, "settings.json"), settings, { mode: 0o600, flag: "wx" });
      if (settings) {
        const fd = openSync(join(staging, "settings.json"), constants.O_RDONLY);
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      const manifest: Manifest = {
        format: 1,
        kind: "moyyi-local-backup",
        createdAt: new Date().toISOString(),
        schemaVersion: receipt.schemaVersion,
        persistedFormat: receipt.persistedFormat,
        sessionCount: receipt.sessionCount,
        credentialsExported: false,
        files: listBackupFiles(staging),
      };
      writePrivateJson(join(staging, "manifest.json"), manifest);
      // Publication is new-only. Never silently overwrite a previous backup.
      try {
        lstatSync(target);
        throw Error("Backup destination already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      renameSync(staging, target);
      syncFolder(parent);
      return {
        kind: "backup",
        path: target,
        rescuePath: null,
        sessionCount: receipt.sessionCount,
        schemaVersion: receipt.schemaVersion,
        persistedFormat: receipt.persistedFormat,
        targetRevision: null,
        ...preserved,
      };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  const backup = realpathSync(request.backupPath);
  const manifest = validateBackup(backup);
  const backups = privateDirectory(join(root, "backups"), true);
  const rescue = join(backups, `before-restore-${randomUUID()}`);
  mkdirSync(rescue, { mode: 0o700 });
  const settings = settingsBytes(home);
  let published = false;
  try {
    const result = await restoreLocalStore({
      dataDirectory,
      backupDirectory: join(backup, "store"),
      expectedDatabaseSha256:
        manifest.files.find((file) => file.path === "store/data.sqlite")?.sha256 ?? "",
      rescueDestination: join(rescue, "store"),
      rescuePublished(receipt) {
        if (settings) {
          writeFileSync(join(rescue, "settings.json"), settings, { mode: 0o600, flag: "wx" });
          const fd = openSync(join(rescue, "settings.json"), constants.O_RDONLY);
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        }
        writePrivateJson(join(rescue, "manifest.json"), {
          format: 1,
          kind: "moyyi-local-backup",
          createdAt: new Date().toISOString(),
          schemaVersion: receipt.schemaVersion,
          persistedFormat: receipt.persistedFormat,
          sessionCount: receipt.sessionCount,
          credentialsExported: false,
          files: listBackupFiles(rescue),
        } satisfies Manifest);
        syncFolder(backups);
        published = true;
      },
    });
    return {
      kind: "restore",
      path: dataDirectory,
      rescuePath: rescue,
      sessionCount: result.sessionCount,
      schemaVersion: result.schemaVersion,
      persistedFormat: result.persistedFormat,
      targetRevision: null,
      ...preserved,
    };
  } finally {
    // Never delete a complete rescue store if publication or replacement became uncertain.
    if (!published && readdirSync(rescue).length === 0) rmSync(rescue, { recursive: true });
  }
}
