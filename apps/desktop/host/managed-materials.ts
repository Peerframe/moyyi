import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  type Stats,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import type { MaterialFormat, MaterialStore, StoredMaterial } from "moyyi/runtime";
import {
  FileBoundaryError,
  locateWorkspaceFile,
  readWorkspaceFile,
  snapshotExternalMaterial,
} from "./materials.ts";

export type MaterialCheckpoint =
  | "source:read"
  | "copy:staged"
  | "copy:before_publish"
  | "copy:published";
interface Operation {
  readonly workspaceRoot: string;
  readonly id: string;
  readonly revision: number;
  readonly signal?: AbortSignal;
}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

/** Native-user actions only. Library recycling is not revocation of the workspace read grant.
 * OpenBot 010439bb owner_files/attachment lifecycle informed these independently written bounds. */
export class ManagedMaterials {
  readonly #store: MaterialStore;
  readonly #excluded: readonly string[];
  readonly #checkpoint: ((point: MaterialCheckpoint) => void) | undefined;
  #busy = false;
  constructor(
    store: MaterialStore,
    options: {
      readonly excluded?: readonly string[];
      readonly checkpoint?: (point: MaterialCheckpoint) => void;
    } = {},
  ) {
    this.#store = store;
    this.#excluded = [...(options.excluded ?? [])];
    this.#checkpoint = options.checkpoint;
  }
  #guard(signal?: AbortSignal): void {
    signal?.throwIfAborted();
  }
  async #nextFile(signal?: AbortSignal): Promise<void> {
    // Let the worker receive native cancel/close IPC between bounded synchronous files.
    // A single 10 MiB snapshot or publication is not interruptible mid-system-call.
    await setImmediate();
    this.#guard(signal);
  }
  async #operation<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    this.#guard(signal);
    if (this.#busy) throw new FileBoundaryError("Another material operation is still running");
    this.#busy = true;
    try {
      return await action();
    } finally {
      this.#busy = false;
    }
  }
  async #record(input: Operation): Promise<StoredMaterial> {
    this.#guard(input.signal);
    const record = await this.#store.get(input.id);
    this.#guard(input.signal);
    if (
      !record ||
      record.workspaceRoot !== input.workspaceRoot ||
      record.revision !== input.revision
    )
      throw new FileBoundaryError("Material changed or belongs to a different workspace");
    return record;
  }
  list(workspaceRoot: string, includeRecycled = true): Promise<readonly StoredMaterial[]> {
    return this.#store.list(workspaceRoot, { includeRecycled });
  }
  async selected(input: {
    readonly sessionId: string;
    readonly workspaceRoot: string;
  }): Promise<readonly StoredMaterial[]> {
    const records = await this.#store.listSession(input.sessionId, input.workspaceRoot);
    if (records.some((record) => record.workspaceRoot !== input.workspaceRoot))
      throw new FileBoundaryError("Material selection belongs to a different workspace");
    return records;
  }
  async importFiles(input: {
    readonly sessionId: string;
    readonly workspaceRoot: string;
    readonly paths: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<readonly StoredMaterial[]> {
    return this.#operation(input.signal, async () => {
      if (
        !Array.isArray(input.paths) ||
        !input.paths.length ||
        input.paths.length > 8 ||
        Object.keys(input.paths).length !== input.paths.length
      )
        throw new FileBoundaryError("Select one to eight material files");
      const selected = await this.selected(input);
      const snapshots: ReturnType<typeof snapshotExternalMaterial>[] = [];
      for (const path of input.paths) {
        await this.#nextFile(input.signal);
        const value = snapshotExternalMaterial(path, this.#excluded, () =>
          this.#guard(input.signal),
        );
        this.#checkpoint?.("source:read");
        this.#guard(input.signal);
        snapshots.push(value);
      }
      const existing: (StoredMaterial | null)[] = [];
      for (const snapshot of snapshots)
        existing.push(
          await this.#store.find(input.workspaceRoot, snapshot.sha256, snapshot.format),
        );
      if (existing.some((record) => record?.state === "recycled"))
        throw new FileBoundaryError("This material is in the recycle bin; restore it explicitly");
      const identities = new Set(selected.map((record) => record.id));
      snapshots.forEach((snapshot, index) => {
        identities.add(existing[index]?.id ?? `${snapshot.sha256}:${snapshot.format}`);
      });
      if (identities.size > 8)
        throw new FileBoundaryError("Select at most eight materials per session");
      const result: StoredMaterial[] = [];
      for (const [index, snapshot] of snapshots.entries()) {
        this.#guard(input.signal);
        const id = `material_${randomUUID()}`;
        let record =
          existing[index] ??
          (await this.#store.create({
            id,
            workspaceRoot: input.workspaceRoot,
            path: `moyyi-materials/${id}.${snapshot.format}`,
            name: snapshot.name,
            format: snapshot.format as MaterialFormat,
            bytes: snapshot.bytes,
            createdAt: new Date().toISOString(),
          }));
        await this.#nextFile(input.signal);
        this.#publish(record, snapshot.bytes, input.signal);
        if (record.state === "pending")
          record = await this.#store.activate(record.id, record.revision);
        if (!result.some((value) => value.id === record.id)) result.push(record);
      }
      this.#guard(input.signal);
      await this.#store.attach(input.sessionId, [
        ...new Set([...selected, ...result].map((record) => record.id)),
      ]);
      const refreshed: StoredMaterial[] = [];
      for (const record of result)
        refreshed.push((await this.#store.get(record.id)) as StoredMaterial);
      return refreshed;
    });
  }
  #publish(record: StoredMaterial, bytes: Uint8Array, signal?: AbortSignal): void {
    this.#guard(signal);
    const folder = join(record.workspaceRoot, "moyyi-materials");
    const parent = locateWorkspaceFile(
      record.workspaceRoot,
      "moyyi-materials",
      this.#excluded,
      true,
    );
    if (!parent.stat) mkdirSync(folder, { mode: 0o700 });
    const folderStat = lstatSync(folder);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink() || folderStat.mode & 0o022)
      throw new FileBoundaryError("The managed material directory is unavailable");
    const before = locateWorkspaceFile(record.workspaceRoot, record.path, this.#excluded, true);
    if (before.stat) {
      this.#verify(record);
      return;
    }
    const temporary = join(folder, `.import-${randomUUID()}.tmp`);
    let fd: number | undefined;
    let staged: Stats | undefined;
    try {
      fd = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      staged = fstatSync(fd);
      let offset = 0;
      while (offset < bytes.byteLength) {
        this.#guard(signal);
        const n = writeSync(fd, bytes, offset, bytes.byteLength - offset);
        if (!n) throw new FileBoundaryError("Material copy made no progress");
        offset += n;
      }
      fsyncSync(fd);
      staged = fstatSync(fd);
      closeSync(fd);
      fd = undefined;
      this.#checkpoint?.("copy:staged");
      this.#guard(signal);
      this.#checkpoint?.("copy:before_publish");
      this.#guard(signal);
      const current = locateWorkspaceFile(record.workspaceRoot, record.path, this.#excluded, true);
      if (
        current.stat ||
        current.parents.length !== before.parents.length ||
        current.parents.some(
          (value, index) => !same(value.stat, before.parents[index]?.stat as Stats),
        )
      )
        throw new FileBoundaryError("Material destination changed before publication");
      const stagedNow = lstatSync(temporary);
      if (
        !same(staged, stagedNow) ||
        !stagedNow.isFile() ||
        stagedNow.nlink !== 1 ||
        stagedNow.size !== bytes.byteLength ||
        stagedNow.mtimeMs !== staged.mtimeMs ||
        stagedNow.ctimeMs !== staged.ctimeMs
      )
        throw new FileBoundaryError("Staged material changed before publication");
      // Like NodeWorkspaceWrites, this is exclusive publication with parent identity checks,
      // not a claim of isolation from a hostile process running under the same OS identity.
      linkSync(temporary, current.absolute);
      unlinkSync(temporary);
      staged = undefined;
      this.#checkpoint?.("copy:published");
      this.#guard(signal);
      const directory = openSync(
        folder,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        if (!same(folderStat, fstatSync(directory)))
          throw new FileBoundaryError("Material directory changed");
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      this.#verify(record);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (staged) {
        try {
          const now = lstatSync(temporary);
          if (
            same(folderStat, lstatSync(folder)) &&
            same(staged, now) &&
            now.isFile() &&
            now.nlink === 1
          )
            unlinkSync(temporary);
        } catch {
          /* A changed parent/inode is never removed as cleanup. */
        }
      }
    }
  }
  #verify(record: StoredMaterial): void {
    const current = readWorkspaceFile(
      record.workspaceRoot,
      record.path,
      this.#excluded,
      10 * 1024 * 1024,
    );
    if (current.sha256 !== record.sha256 || current.sourceBytes !== record.sourceBytes)
      throw new FileBoundaryError("The managed copy changed; the immutable original was preserved");
  }
  async read(input: Operation): Promise<Uint8Array> {
    const record = await this.#record(input);
    return this.#store.read(record.id, record.revision);
  }
  async attach(input: {
    readonly sessionId: string;
    readonly workspaceRoot: string;
    readonly ids: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<void> {
    return this.#operation(input.signal, async () => {
      if (
        !Array.isArray(input.ids) ||
        input.ids.length > 8 ||
        Object.keys(input.ids).length !== input.ids.length
      )
        throw new FileBoundaryError("Select at most eight materials");
      await this.selected(input);
      for (const id of input.ids) {
        const record = await this.#store.get(id);
        this.#guard(input.signal);
        if (!record || record.workspaceRoot !== input.workspaceRoot || record.state !== "active")
          throw new FileBoundaryError("Material is unavailable to this session");
        this.#verify(record);
      }
      await this.#store.attach(input.sessionId, input.ids);
    });
  }
  async recycle(input: Operation): Promise<StoredMaterial> {
    return this.#operation(input.signal, async () => {
      const record = await this.#record(input);
      // Keep the workspace copy: recycling selection cannot revoke its existing read grant.
      return this.#store.recycle(record.id, record.revision);
    });
  }
  async restore(input: Operation): Promise<StoredMaterial> {
    return this.#operation(input.signal, async () => {
      const record = await this.#record(input);
      if (record.state !== "recycled" && record.state !== "pending")
        throw new FileBoundaryError("Only recycled or pending materials can be restored");
      const bytes = await this.#store.read(record.id, record.revision);
      await this.#nextFile(input.signal);
      this.#publish(record, bytes, input.signal);
      return record.state === "pending"
        ? this.#store.activate(record.id, record.revision)
        : this.#store.restore(record.id, record.revision);
    });
  }
  async purge(input: Operation): Promise<StoredMaterial> {
    return this.#operation(input.signal, async () => {
      const record = await this.#record(input);
      if (record.state !== "recycled" || record.referenceCount)
        throw new FileBoundaryError("Only unreferenced recycled materials can be cleared");
      const target = locateWorkspaceFile(record.workspaceRoot, record.path, this.#excluded, true);
      if (target.stat) {
        this.#verify(record);
        this.#guard(input.signal);
        const current = locateWorkspaceFile(record.workspaceRoot, record.path, this.#excluded);
        if (
          !current.stat ||
          !same(target.stat, current.stat) ||
          current.parents.length !== target.parents.length ||
          current.parents.some(
            (parent, index) => !same(parent.stat, target.parents[index]?.stat as Stats),
          )
        )
          throw new FileBoundaryError("Material copy changed before removal");
        unlinkSync(current.absolute);
        const directory = openSync(
          dirname(current.absolute),
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      }
      // This removes the library item, not shared content-addressed blobs or historical data.
      return this.#store.purge(record.id, record.revision);
    });
  }
  setHousekeeping(workspaceRoot: string, enabled: boolean): Promise<void> {
    return this.#operation(undefined, () => this.#store.setHousekeeping(workspaceRoot, enabled));
  }
  async housekeeping(input: {
    readonly workspaceRoot: string;
    readonly now?: number;
    readonly signal?: AbortSignal;
  }): Promise<readonly StoredMaterial[]> {
    if (!(await this.#store.housekeeping(input.workspaceRoot))) return [];
    const now = input.now ?? Date.now();
    if (!Number.isFinite(now)) throw new FileBoundaryError("Invalid housekeeping time");
    const result: StoredMaterial[] = [];
    for (const record of await this.#store.list(input.workspaceRoot)) {
      this.#guard(input.signal);
      if (
        record.state === "active" &&
        !record.referenceCount &&
        Date.parse(record.createdAt) <= now - 30 * 86400_000
      )
        result.push(await this.recycle({ ...input, id: record.id, revision: record.revision }));
    }
    return result;
  }
}
