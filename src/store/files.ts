import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BlobRef } from "../contracts/index.ts";

const blobReference = /^sha256:[0-9a-f]{64}$/;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function assertDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Managed path must be a directory, never a symbolic link: ${path}`);
  }
}

export function assertRegularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Managed path must be a regular file, never a symbolic link: ${path}`);
  }
}

export function syncDirectory(path: string): void {
  assertDirectory(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function privateDirectory(path: string, recursive = false): void {
  let firstCreated: string | undefined;
  try {
    firstCreated = mkdirSync(path, { mode: 0o700, recursive });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  assertDirectory(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fchmodSync(fd, 0o700);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let parent = dirname(path);
  syncDirectory(parent);
  // Recursive creation also introduces directory entries above the immediate parent.
  if (firstCreated !== undefined) {
    const existingParent = dirname(firstCreated);
    while (parent !== existingParent) {
      parent = dirname(parent);
      syncDirectory(parent);
    }
  }
}

/** Local filesystems on macOS/Linux only; synchronization is not a hardware power-loss test. */
export function prepareDataDirectory(input: string): string {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error(`Unsupported storage platform: ${process.platform}`);
  }
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new TypeError("Data directory must be a non-empty path");
  }
  const path = resolve(input);
  if (dirname(path) === path) throw new Error("The filesystem root cannot be a data directory");
  privateDirectory(path, true);
  return realpathSync(path);
}

/**
 * SQLite owns all descriptors for this inode. Never unlink, replace, back up or open/close this
 * file through native fs APIs: closing a separate POSIX descriptor can release its locks.
 */
export function acquireWriterLock(root: string): () => void {
  assertDirectory(root);
  const path = join(root, "writer-lock.sqlite");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    try {
      assertRegularFile(`${path}${suffix}`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const database = new DatabaseSync(path, { timeout: 0 });
  try {
    assertRegularFile(path);
    chmodSync(path, 0o600);
    const journal = database.prepare("PRAGMA journal_mode=DELETE").get();
    if (journal?.journal_mode !== "delete")
      throw new Error("Writer lock requires DELETE journal mode");
    database.exec("BEGIN EXCLUSIVE");
    if (!database.isTransaction) throw new Error("Writer lock transaction did not start");
  } catch (error) {
    database.close();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (database.isTransaction) database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  };
}

export class BlobStore {
  readonly #root: string;
  readonly #directory: string;
  readonly #maxBlobBytes: number;

  constructor(root: string, maxBlobBytes = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBlobBytes) || maxBlobBytes < 0) {
      throw new TypeError("Blob byte limit must be a non-negative safe integer");
    }
    this.#root = prepareDataDirectory(root);
    this.#directory = join(this.#root, "blobs");
    privateDirectory(this.#directory);
    this.#maxBlobBytes = maxBlobBytes;
  }

  pathFor(ref: BlobRef): string {
    if (typeof ref !== "string" || !blobReference.test(ref)) {
      throw new TypeError("Invalid SHA-256 blob reference");
    }
    return join(this.#directory, ref.slice("sha256:".length));
  }

  put(bytes: Uint8Array): BlobRef {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("Blob content must be bytes");
    if (bytes.byteLength > this.#maxBlobBytes) throw new RangeError("Blob exceeds its byte limit");
    const snapshot = Buffer.from(bytes);
    const ref = `sha256:${createHash("sha256").update(snapshot).digest("hex")}` as BlobRef;
    const path = this.pathFor(ref);
    if (this.#read(ref, true) !== null) {
      syncDirectory(this.#directory);
      return ref;
    }
    const temporary = join(this.#directory, `.blob-${randomUUID()}.tmp`);
    let fd: number | undefined;
    let created = false;
    try {
      fd = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      let offset = 0;
      while (offset < snapshot.byteLength) {
        const count = writeSync(fd, snapshot, offset, snapshot.byteLength - offset);
        if (count === 0) throw new Error("Blob write made no progress");
        offset += count;
      }
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      // link is atomic and refuses to replace an existing blob. rename would overwrite it.
      try {
        linkSync(temporary, path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if (this.#read(ref, true) === null) throw new Error("Blob disappeared during publication");
      }
      return ref;
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (created) {
        unlinkSync(temporary);
        // The published link and temporary-file removal become durable before put returns.
        syncDirectory(this.#directory);
      }
    }
  }

  get(ref: BlobRef): Uint8Array | null {
    return this.#read(ref, false);
  }

  assert(ref: BlobRef): void {
    if (this.get(ref) === null) throw new Error(`Missing blob: ${ref}`);
  }

  #read(ref: BlobRef, durable: boolean): Uint8Array | null {
    const path = this.pathFor(ref);
    assertDirectory(this.#root);
    assertDirectory(this.#directory);
    let fd: number;
    try {
      assertRegularFile(path);
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error(`Blob is not a regular file: ${ref}`);
      if (!Number.isSafeInteger(stat.size) || stat.size > this.#maxBlobBytes) {
        throw new RangeError(`Blob exceeds its byte limit: ${ref}`);
      }
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const count = readSync(fd, bytes, offset, bytes.byteLength - offset, offset);
        if (count === 0) throw new Error(`Blob changed while reading: ${ref}`);
        offset += count;
      }
      if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) {
        throw new Error(`Blob changed while reading: ${ref}`);
      }
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actual !== ref) throw new Error(`Blob hash mismatch: ${ref}`);
      if (durable) fsyncSync(fd);
      return bytes;
    } finally {
      closeSync(fd);
    }
  }
}
