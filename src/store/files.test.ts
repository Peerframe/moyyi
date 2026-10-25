import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlobRef } from "../contracts/index.ts";
import {
  acquireWriterLock,
  assertRegularFile,
  BlobStore,
  prepareDataDirectory,
  syncDirectory,
} from "./files.ts";

let temporary: string;
let releases: (() => void)[];

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "moyyi-files-test-"));
  releases = [];
});

afterEach(() => {
  for (const release of releases.reverse()) release();
  rmSync(temporary, { recursive: true, force: true });
});

const refFor = (bytes: Uint8Array): BlobRef =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}` as BlobRef;

describe("data directory", () => {
  it("creates a canonical private directory, including missing parents", () => {
    const input = join(temporary, "nested", "data");
    expect(prepareDataDirectory(input)).toBe(realpathSync(input));
    expect(statSync(input).mode & 0o777).toBe(0o700);
    expect(statSync(join(temporary, "nested")).mode & 0o777).toBe(0o700);
    expect(() => syncDirectory(input)).not.toThrow();
  });

  it("rejects invalid roots and symbolic links before changing their target", () => {
    expect(() => prepareDataDirectory("")).toThrow("non-empty");
    expect(() => prepareDataDirectory("/")).toThrow("filesystem root");
    const target = join(temporary, "target");
    mkdirSync(target, { mode: 0o755 });
    const mode = statSync(target).mode;
    const link = join(temporary, "link");
    symlinkSync(target, link);
    expect(() => prepareDataDirectory(link)).toThrow("symbolic link");
    expect(statSync(target).mode).toBe(mode);
  });

  it("distinguishes files, directories and symbolic links", () => {
    const file = join(temporary, "file");
    const link = join(temporary, "link");
    writeFileSync(file, "data");
    symlinkSync(file, link);
    expect(() => assertRegularFile(file)).not.toThrow();
    expect(() => assertRegularFile(temporary)).toThrow("regular file");
    expect(() => assertRegularFile(link)).toThrow("symbolic link");
    expect(() => syncDirectory(file)).toThrow("directory");
    expect(() => syncDirectory(link)).toThrow("symbolic link");
  });
});

describe("writer lock", () => {
  it("excludes another connection and keeps the lock after a failed contender closes", () => {
    const root = prepareDataDirectory(join(temporary, "data"));
    const release = acquireWriterLock(root);
    releases.push(release);
    expect(() => acquireWriterLock(root)).toThrow(/locked/);

    // A process-level probe catches accidentally releasing POSIX locks by closing a second
    // descriptor, which an in-process SQLite connection list could otherwise conceal.
    const contender = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[1], { timeout: 0 });
try { db.exec('BEGIN EXCLUSIVE'); process.exitCode = 1; }
catch (error) { process.stdout.write(String(error.errcode)); }
finally { db.close(); }`,
        join(root, "writer-lock.sqlite"),
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
    expect(contender.error).toBeUndefined();
    expect(contender.status).toBe(0);
    expect(contender.stdout).toBe("5");

    const inode = statSync(join(root, "writer-lock.sqlite")).ino;
    release();
    release();
    releases.push(acquireWriterLock(root));
    expect(statSync(join(root, "writer-lock.sqlite")).ino).toBe(inode);
    expect(statSync(join(root, "writer-lock.sqlite")).mode & 0o777).toBe(0o600);
  });

  it.each(["", "-journal", "-wal", "-shm"])(
    "rejects a symbolic link or directory at writer-lock.sqlite%s",
    (suffix) => {
      const root = prepareDataDirectory(join(temporary, "data"));
      const target = join(temporary, "untouched");
      writeFileSync(target, "untouched");
      const path = join(root, `writer-lock.sqlite${suffix}`);
      symlinkSync(target, path);
      expect(() => acquireWriterLock(root)).toThrow("symbolic link");
      expect(readFileSync(target, "utf8")).toBe("untouched");
      rmSync(path);
      mkdirSync(path);
      expect(() => acquireWriterLock(root)).toThrow("regular file");
    },
  );
});

describe("BlobStore", () => {
  it("publishes content under its SHA-256, privately and without temporary leftovers", () => {
    const root = join(temporary, "data");
    const store = new BlobStore(root);
    const bytes = Buffer.from("hello, 世界");
    const ref = store.put(bytes);
    expect(ref).toBe(refFor(bytes));
    expect(store.pathFor(ref)).toBe(join(realpathSync(root), "blobs", ref.slice(7)));
    expect(store.get(ref)).toEqual(bytes);
    expect(() => store.assert(ref)).not.toThrow();
    expect(statSync(store.pathFor(ref)).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "blobs")).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(root, "blobs"))).toEqual([ref.slice(7)]);
  });

  it("deduplicates repeated bytes without replacing the existing inode", () => {
    const store = new BlobStore(join(temporary, "data"));
    const bytes = Buffer.from("deduplicated");
    const ref = store.put(bytes);
    const inode = statSync(store.pathFor(ref)).ino;
    expect(store.put(bytes)).toBe(ref);
    expect(statSync(store.pathFor(ref)).ino).toBe(inode);
    expect(readdirSync(join(temporary, "data", "blobs"))).toEqual([ref.slice(7)]);
  });

  it("supports an empty blob and distinguishes a missing blob", () => {
    const store = new BlobStore(join(temporary, "data"), 0);
    const ref = store.put(new Uint8Array());
    expect(ref).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(store.get(ref)).toEqual(Buffer.alloc(0));
    const missing = `sha256:${"0".repeat(64)}` as BlobRef;
    expect(store.get(missing)).toBeNull();
    expect(() => store.assert(missing)).toThrow("Missing blob");
  });

  it("rejects corrupt existing content on read, assert and dedup without replacing it", () => {
    const store = new BlobStore(join(temporary, "data"));
    const bytes = Buffer.from("original");
    const ref = store.put(bytes);
    writeFileSync(store.pathFor(ref), "corrupt!");
    expect(() => store.get(ref)).toThrow("hash mismatch");
    expect(() => store.assert(ref)).toThrow("hash mismatch");
    expect(() => store.put(bytes)).toThrow("hash mismatch");
    expect(readFileSync(store.pathFor(ref), "utf8")).toBe("corrupt!");
    expect(readdirSync(join(temporary, "data", "blobs"))).toEqual([ref.slice(7)]);
  });

  it("enforces its byte limit on writes and existing files", () => {
    const root = join(temporary, "data");
    const store = new BlobStore(root, 3);
    expect(() => store.put(Buffer.from("four"))).toThrow("byte limit");
    const ref = store.put(Buffer.from("abc"));
    expect(store.get(ref)).toEqual(Buffer.from("abc"));
    expect(() => new BlobStore(root, 2).get(ref)).toThrow("byte limit");
    expect(() => new BlobStore(root, -1)).toThrow("non-negative safe integer");
    expect(() => new BlobStore(root, Number.POSITIVE_INFINITY)).toThrow(
      "non-negative safe integer",
    );
    expect(readdirSync(join(root, "blobs"))).toEqual([ref.slice(7)]);
  });

  it.each([
    "../outside",
    "sha256:abc",
    `sha256:${"A".repeat(64)}`,
    `sha256:${"0".repeat(64)}/../outside`,
  ])("rejects malformed references: %s", (value) => {
    const store = new BlobStore(join(temporary, "data"));
    const ref = value as BlobRef;
    expect(() => store.pathFor(ref)).toThrow("Invalid SHA-256");
    expect(() => store.get(ref)).toThrow("Invalid SHA-256");
    expect(() => store.assert(ref)).toThrow("Invalid SHA-256");
  });

  it("rejects a symbolic link even when its target has the correct blob content", () => {
    const store = new BlobStore(join(temporary, "data"));
    const bytes = Buffer.from("external");
    const ref = refFor(bytes);
    const target = join(temporary, "external");
    writeFileSync(target, bytes);
    symlinkSync(target, store.pathFor(ref));
    expect(() => store.get(ref)).toThrow("symbolic link");
    expect(() => store.put(bytes)).toThrow("symbolic link");
    expect(lstatSync(store.pathFor(ref)).isSymbolicLink()).toBe(true);
    expect(readFileSync(target)).toEqual(bytes);
  });

  it("rejects a replaced blobs directory before accessing its target", () => {
    const root = join(temporary, "data");
    const store = new BlobStore(root);
    const external = join(temporary, "external");
    mkdirSync(external);
    rmSync(join(root, "blobs"), { recursive: true });
    symlinkSync(external, join(root, "blobs"));
    expect(() => store.put(Buffer.from("blocked"))).toThrow("symbolic link");
    expect(() => store.get(refFor(Buffer.from("missing")))).toThrow("symbolic link");
    expect(() => new BlobStore(root)).toThrow("symbolic link");
    expect(readdirSync(external)).toEqual([]);
  });
});
