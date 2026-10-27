import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SqliteSessionStore } from "./index.ts";

export interface LocalStoreReceipt {
  readonly directory: string;
  readonly schemaVersion: number;
  readonly persistedFormat: number;
  readonly sessionCount: number;
}

function directory(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe maintenance directory");
  return realpathSync(path);
}

/** Copies an untrusted snapshot without following links or loading an entire database in RAM. */
function copyFile(
  source: string,
  destination: string,
  maximum: number,
  expectedHash?: string,
): number {
  const input = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let output: number | undefined;
  try {
    const before = fstatSync(input);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
      throw Error("Invalid or oversized maintenance file");
    output = openSync(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < before.size) {
      const count = readSync(
        input,
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (!count) throw Error("Maintenance source changed");
      hash.update(buffer.subarray(0, count));
      let written = 0;
      while (written < count) {
        const n = writeSync(output, buffer, written, count - written);
        if (!n) throw Error("Maintenance copy made no progress");
        written += n;
      }
      position += count;
    }
    const after = fstatSync(input);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw Error("Maintenance source changed");
    if (expectedHash && hash.digest("hex") !== expectedHash)
      throw Error("Backup database hash changed");
    fsyncSync(output);
    return before.size;
  } finally {
    closeSync(input);
    if (output !== undefined) closeSync(output);
  }
}

async function receipt(store: SqliteSessionStore, path: string): Promise<LocalStoreReceipt> {
  const sessions = await store.listSessions();
  for (const id of sessions) await store.loadSession(id);
  const diagnostic = store.diagnostics();
  if (diagnostic.integrity !== "ok") throw Error("Invalid store integrity");
  return {
    directory: path,
    schemaVersion: diagnostic.schemaVersion,
    persistedFormat: diagnostic.persistedFormat,
    sessionCount: sessions.length,
  };
}

export async function backupLocalStore(options: {
  dataDirectory: string;
  destination: string;
}): Promise<LocalStoreReceipt> {
  const source = directory(options.dataDirectory);
  const store = new SqliteSessionStore(source);
  try {
    const result = await receipt(store, resolve(options.destination));
    await store.backup(options.destination);
    return result;
  } finally {
    store.close();
  }
}

export async function restoreLocalStore(options: {
  dataDirectory: string;
  backupDirectory: string;
  rescueDestination: string;
  expectedDatabaseSha256?: string;
  /** Trusted host durably publishes its rescue manifest before any database replacement. */
  rescuePublished?: (receipt: LocalStoreReceipt) => void;
}): Promise<LocalStoreReceipt & { readonly rescueDirectory: string }> {
  const destination = directory(options.dataDirectory);
  const source = directory(options.backupDirectory);
  if (source === destination) throw Error("Cannot restore from the live store");
  const staging = mkdtempSync(join(dirname(destination), ".restore-"));
  let candidate: SqliteSessionStore | undefined;
  let current: SqliteSessionStore | undefined;
  try {
    if (readdirSync(source).sort().join() !== "blobs,data.sqlite")
      throw Error("Restore requires a published self-contained store backup");
    const copy = join(staging, "copy");
    mkdirSync(copy, { mode: 0o700 });
    let bytes = copyFile(
      join(source, "data.sqlite"),
      join(copy, "data.sqlite"),
      512 * 1024 * 1024,
      options.expectedDatabaseSha256,
    );
    const blobs = directory(join(source, "blobs"));
    const names = readdirSync(blobs);
    if (names.length > 100_000) throw Error("Backup has too many blobs");
    mkdirSync(join(copy, "blobs"), { mode: 0o700 });
    for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name)) throw Error("Invalid backup blob name");
      bytes += copyFile(join(blobs, name), join(copy, "blobs", name), 64 * 1024 * 1024);
      if (bytes > 2 * 1024 * 1024 * 1024) throw Error("Backup exceeds maintenance size limit");
    }
    // Validation/migration touches only this private copy, never the selected backup or live DB.
    candidate = new SqliteSessionStore(copy);
    const result = await receipt(candidate, destination);
    const prepared = join(staging, "prepared");
    await candidate.backup(prepared);
    candidate.close();
    candidate = undefined;
    current = new SqliteSessionStore(destination);
    const rescue = await receipt(current, resolve(options.rescueDestination));
    await current.restoreSnapshot(prepared, options.rescueDestination, () =>
      options.rescuePublished?.(rescue),
    );
    return { ...result, rescueDirectory: resolve(options.rescueDestination) };
  } finally {
    current?.close();
    candidate?.close();
    rmSync(staging, { recursive: true, force: true });
  }
}
