import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import { link, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  EffectRecord,
  FileVersion,
  ReconcileOutcome,
  ToolContext,
  WorkspaceChange,
  WorkspaceSnapshot,
  WorkspaceSnapshotStore,
  WorkspaceWriteReceipt,
  WorkspaceWriteScope,
  WorkspaceWrites,
  WorkspaceWritesFactory,
} from "../contracts/index.ts";
import { assertUnprotected } from "./preconditions.ts";

const MAX_BYTES = 1024 * 1024;
const hashPattern = /^[0-9a-f]{64}$/;
export type WriteCheckpoint =
  | "before_snapshot"
  | "after_snapshot"
  | "after_stage_sync"
  | "before_publish"
  | "after_create_link"
  | "after_publish"
  | "after_parent_sync";
export interface WorkspaceWriteOptions {
  readonly checkpoint?: (point: WriteCheckpoint) => void;
}
class WriteError extends Error {}
interface Identity {
  readonly path: string;
  readonly stat: Stats;
}
interface Target {
  readonly root: Identity;
  readonly parents: readonly Identity[];
  readonly path: string;
  readonly relative: string;
  readonly stat: Stats | null;
}
interface Inspected {
  readonly target: Target;
  readonly version: FileVersion;
  readonly bytes: Uint8Array | null;
}

/** One approved, single-file effect at a time. Installed code is trusted, not sandboxed. */
export class NodeWorkspaceWrites implements WorkspaceWritesFactory {
  private readonly excluded: readonly string[];
  private readonly store: WorkspaceSnapshotStore;
  private readonly options: WorkspaceWriteOptions;
  constructor(
    store: WorkspaceSnapshotStore,
    excluded: readonly string[] = [],
    options: WorkspaceWriteOptions = {},
  ) {
    this.store = store;
    this.options = options;
    this.excluded = excluded.flatMap((input) => {
      if (!isAbsolute(input)) throw new Error("Protected paths must be absolute");
      const lexical = resolve(input);
      let ancestor = lexical;
      const missing: string[] = [];
      for (;;) {
        try {
          lstatSync(ancestor);
          break;
        } catch (error) {
          if (!isMissing(error) || dirname(ancestor) === ancestor) throw error;
          missing.unshift(basename(ancestor));
          ancestor = dirname(ancestor);
        }
      }
      return [lexical, resolve(realpathSync(ancestor), ...missing)];
    });
  }

  create(context: ToolContext, guard: () => void, scope: WorkspaceWriteScope): WorkspaceWrites {
    const session = new WriteScope(context, guard, scope, this.store, this.excluded, this.options);
    return Object.freeze({
      inspect: (path: string) => session.inspect(path),
      inspectUndo: (snapshotId: string) => session.inspectUndo(snapshotId),
      apply: () => session.apply(),
      reconcile: () => {
        if (!scope.effect)
          return Promise.resolve({ resolved: false as const, reason: "No recovery effect" });
        return this.reconcile(scope.effect, context, guard);
      },
    });
  }

  async reconcile(
    effect: EffectRecord,
    context: ToolContext,
    guard: () => void = () => {},
  ): Promise<ReconcileOutcome> {
    const scope = new WriteScope(
      context,
      () => {
        if (context.signal.aborted) throw new WriteError("Inspection cancelled");
        guard();
      },
      { phase: "prepare" },
      this.store,
      this.excluded,
      {},
    );
    try {
      guard();
      const snapshot = await this.store.getSnapshotForEffect(effect.id);
      guard();
      if (context.signal.aborted) return { resolved: false, reason: "Inspection cancelled" };
      if (!snapshot)
        return {
          resolved: true,
          status: "failed",
          evidence: "No durable snapshot; publication was not reached.",
        };
      if (snapshot.effectId !== effect.id || snapshot.runId !== effect.runId)
        return { resolved: false, reason: "Snapshot identity mismatch" };
      await scope.verifySnapshotWorkspace(snapshot);
      const current = await scope.inspect(snapshot.path);
      if (matches(current, snapshot.afterHash, snapshot.afterMode)) {
        return {
          resolved: true,
          status: "succeeded",
          evidence:
            "Observed current hash and mode match the intended post-state; attribution and durability of the original execution are not proven.",
        };
      }
      if (matches(current, snapshot.beforeHash, snapshot.beforeMode)) {
        return {
          resolved: true,
          status: "failed",
          evidence:
            "Observed current hash and mode match the pre-state; no automatic replay. This does not prove that no transient change occurred.",
        };
      }
      return { resolved: false, reason: "Current file matches neither recorded state" };
    } catch {
      return { resolved: false, reason: "Snapshot or workspace cannot be safely inspected" };
    }
  }
}

class WriteScope {
  private rootIdentity?: Identity;
  private applied = false;
  private readonly context: ToolContext;
  private readonly authorized: () => void;
  private readonly scope: WorkspaceWriteScope;
  private readonly store: WorkspaceSnapshotStore;
  private readonly excluded: readonly string[];
  private readonly options: WorkspaceWriteOptions;
  constructor(
    context: ToolContext,
    authorized: () => void,
    scope: WorkspaceWriteScope,
    store: WorkspaceSnapshotStore,
    excluded: readonly string[],
    options: WorkspaceWriteOptions,
  ) {
    this.context = context;
    this.authorized = authorized;
    this.scope = scope;
    this.store = store;
    this.excluded = excluded;
    this.options = options;
  }

  private guard(): void {
    if (process.platform !== "darwin" && process.platform !== "linux")
      throw new WriteError("Workspace writes require macOS or Linux local filesystem support");
    if (this.context.signal.aborted) throw new WriteError("Workspace write cancelled");
    this.authorized();
  }
  private async io<T>(operation: () => Promise<T>): Promise<T> {
    this.guard();
    const result = await operation();
    this.guard();
    return result;
  }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    this.guard();
    try {
      const result = await operation();
      this.guard();
      return result;
    } catch (error) {
      if (error instanceof WriteError) throw error;
      // Filesystem/store diagnostics can contain absolute private paths or file contents.
      throw new WriteError("Workspace write unavailable, cancelled, revoked, or target changed");
    }
  }
  private protected(path: string): void {
    try {
      assertUnprotected(path);
    } catch {
      throw new WriteError("Protected credential path is outside the workspace write grant");
    }
    if (
      path.split(sep).some((part) => [".git", ".moyyi"].includes(part.toLowerCase())) ||
      this.excluded.some((directory) => within(directory, path))
    )
      throw new WriteError(
        "Protected runtime or repository data is outside the workspace write grant",
      );
  }
  private async root(): Promise<Identity> {
    const declared = this.context.workspaceRoot;
    if (!isAbsolute(declared)) throw new WriteError("Workspace must be absolute");
    this.protected(declared);
    const stat = await this.io(() => lstat(declared));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new WriteError("Workspace must be a real directory");
    const path = await this.io(() => realpath(declared));
    this.protected(path);
    const result = { path, stat };
    if (
      this.rootIdentity &&
      (!same(this.rootIdentity.stat, stat) || this.rootIdentity.path !== path)
    )
      throw new WriteError("Workspace identity changed");
    this.rootIdentity ??= result;
    return result;
  }
  private async locate(input: string): Promise<Target> {
    const parts = pathParts(input);
    const root = await this.root();
    const parents: Identity[] = [root];
    let path = root.path;
    for (const [index, part] of parts.entries()) {
      path = resolve(path, part);
      this.protected(path);
      let stat: Stats | null;
      try {
        stat = await this.io(() => lstat(path));
      } catch (error) {
        if (!isMissing(error)) throw error;
        this.guard();
        stat = null;
      }
      if (stat?.isSymbolicLink())
        throw new WriteError("Write paths may not contain symbolic links");
      if (index < parts.length - 1) {
        if (!stat?.isDirectory()) throw new WriteError("Parent directory must already exist");
        parents.push({ path, stat });
      } else return { root, parents, path, relative: parts.join("/"), stat };
    }
    throw new WriteError("A file path is required");
  }
  private async unchanged(target: Target): Promise<Target> {
    const current = await this.locate(target.relative);
    if (
      current.parents.length !== target.parents.length ||
      current.parents.some(
        (parent, i) => !same(parent.stat, (target.parents[i] as Identity).stat),
      ) ||
      current.path !== target.path
    )
      throw new WriteError("Workspace parent identity changed");
    return current;
  }
  private async read(input: string): Promise<Inspected> {
    const target = await this.locate(input);
    if (!target.stat) {
      const current = await this.unchanged(target);
      if (current.stat) throw new WriteError("Target appeared during inspection");
      return {
        target,
        version: { path: target.relative, text: null, sha256: null, mode: null },
        bytes: null,
      };
    }
    regular(target.stat);
    this.guard();
    const file = await open(
      target.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      this.guard();
      const before = await this.io(() => file.stat());
      regular(before);
      if (!same(before, target.stat)) throw new WriteError("Target changed before opening");
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const result = await this.io(() =>
          file.read(buffer, offset, Math.min(64 * 1024, buffer.length - offset), offset),
        );
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset > MAX_BYTES) throw new WriteError("Workspace text exceeds 1 MiB limit");
      const after = await this.io(() => file.stat());
      regular(after);
      const current = await this.unchanged(target);
      if (
        !current.stat ||
        !same(current.stat, before) ||
        !unchangedFile(before, after) ||
        !unchangedFile(after, current.stat)
      )
        throw new WriteError("Target changed during inspection");
      const bytes = buffer.subarray(0, offset);
      const text = decode(bytes);
      return {
        target,
        version: { path: target.relative, text, sha256: hash(bytes), mode: before.mode & 0o777 },
        bytes,
      };
    } finally {
      await file.close();
    }
  }

  inspect(path: string): Promise<FileVersion> {
    return this.safe(async () => (await this.read(path)).version);
  }
  async verifySnapshotWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    if (snapshot.workspaceRoot !== (await this.root()).path)
      throw new WriteError("Snapshot belongs to another workspace");
  }
  private async undo(id: string): Promise<WorkspaceChange> {
    if (typeof id !== "string" || !id.length || id.length > 512)
      throw new WriteError("Invalid snapshot identifier");
    const snapshot = await this.io(() => this.store.getSnapshot(id));
    if (snapshot?.version !== 1 || snapshot.id !== id || snapshot.effectId !== id)
      throw new WriteError("Snapshot is unavailable");
    await this.verifySnapshotWorkspace(snapshot);
    let text: string | null = null;
    if (snapshot.beforeBlob !== null) {
      const bytes = await this.io(() =>
        this.store.getBlob(snapshot.beforeBlob as NonNullable<WorkspaceSnapshot["beforeBlob"]>),
      );
      if (
        !bytes ||
        bytes.byteLength > MAX_BYTES ||
        hash(bytes) !== snapshot.beforeHash ||
        snapshot.beforeBlob !== `sha256:${snapshot.beforeHash}`
      )
        throw new WriteError("Snapshot content is missing or corrupt");
      text = decode(bytes);
    } else if (snapshot.beforeHash !== null || snapshot.beforeMode !== null) {
      throw new WriteError("Snapshot pre-state is invalid");
    }
    const current = (await this.read(snapshot.path)).version;
    if (!matches(current, snapshot.afterHash, snapshot.afterMode))
      throw new WriteError("File changed after the recorded action; undo refused");
    return change({
      path: snapshot.path,
      expectedHash: snapshot.afterHash,
      text,
      mode: snapshot.beforeMode,
      restoreOf: id,
    });
  }
  inspectUndo(id: string): Promise<WorkspaceChange> {
    return this.safe(() => this.undo(id));
  }
  apply(): Promise<WorkspaceWriteReceipt> {
    return this.safe(async () => {
      if (this.applied) throw new WriteError("Write capability can be applied only once");
      this.applied = true;
      const { effect, action } = this.scope;
      if (
        this.scope.phase !== "execute" ||
        !effect ||
        !action ||
        effect.state !== "started" ||
        effect.profile.class !== "workspace_write" ||
        effect.runId !== this.context.runId ||
        effect.digest !== action.digest
      )
        throw new WriteError(
          "Write capability requires its durable started effect and approved action",
        );
      const mutation = change(action.payload);
      if (
        !action.preconditions.some(
          (p) =>
            p.kind === "file_hash" &&
            p.path === mutation.path &&
            p.sha256 === mutation.expectedHash,
        )
      )
        throw new WriteError("Approved action is missing its exact file hash precondition");
      if (mutation.restoreOf !== undefined) {
        const restored = await this.undo(mutation.restoreOf);
        if (JSON.stringify(restored) !== JSON.stringify(mutation))
          throw new WriteError("Undo payload differs from the durable snapshot");
      } else if (mutation.text === null)
        throw new WriteError("Only snapshot undo may remove a file");
      const before = await this.read(mutation.path);
      if (before.version.sha256 !== mutation.expectedHash)
        throw new WriteError("File hash precondition changed before execution");
      if (mutation.restoreOf === undefined && mutation.mode !== (before.version.mode ?? 0o600))
        throw new WriteError("Writes must preserve ordinary permissions; new files use 0600");
      const afterBytes = mutation.text === null ? null : new TextEncoder().encode(mutation.text);
      const afterHash = afterBytes === null ? null : hash(afterBytes);
      this.checkpoint("before_snapshot");
      const beforeBlob =
        before.bytes === null
          ? null
          : await this.io(() => this.store.putBlob(before.bytes as Uint8Array));
      const snapshot: WorkspaceSnapshot = {
        version: 1,
        id: effect.id,
        effectId: effect.id,
        runId: this.context.runId,
        workspaceRoot: before.target.root.path,
        path: mutation.path,
        beforeBlob,
        beforeHash: before.version.sha256,
        afterHash,
        beforeMode: before.version.mode,
        afterMode: mutation.mode,
        ...(mutation.restoreOf === undefined ? {} : { restoreOf: mutation.restoreOf }),
      };
      await this.io(() => this.store.saveSnapshot(snapshot));
      this.checkpoint("after_snapshot");
      let staging: string | undefined;
      let stagingStat: Stats | undefined;
      let stagedVersion: Stats | undefined;
      try {
        if (afterBytes !== null) {
          await this.unchanged(before.target);
          staging = resolve(dirname(before.target.path), `.moyyi-write-${randomUUID()}.tmp`);
          this.guard();
          const handle = await open(
            staging,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
          );
          try {
            this.guard();
            stagingStat = await this.io(() => handle.stat());
            await this.io(() => handle.writeFile(afterBytes));
            await this.io(() => handle.chmod(mutation.mode as number));
            await this.io(() => handle.sync());
            stagedVersion = await this.io(() => handle.stat());
          } finally {
            try {
              stagingStat ??= await handle.stat();
            } finally {
              await handle.close();
            }
          }
          this.checkpoint("after_stage_sync");
        }
        this.checkpoint("before_publish");
        const current = await this.read(mutation.path);
        await this.unchanged(before.target);
        if (
          !matches(current.version, before.version.sha256, before.version.mode) ||
          (before.target.stat &&
            (!current.target.stat || !same(before.target.stat, current.target.stat)))
        )
          throw new WriteError("File identity, hash or permissions changed before publication");
        if (staging && stagedVersion) {
          const stagedNow = await this.io(() => lstat(staging as string));
          if (
            !stagedNow.isFile() ||
            stagedNow.isSymbolicLink() ||
            stagedNow.nlink !== 1 ||
            !unchangedFile(stagedVersion, stagedNow)
          )
            throw new WriteError("Staged file changed before publication");
        }
        this.guard();
        // rename replaces one directory entry atomically, but it is not hash-CAS. Parent
        // identity checks do not establish isolation from a hostile same-user process.
        if (afterBytes === null) {
          await unlink(before.target.path);
        } else if (before.version.sha256 === null) {
          // link refuses an existing destination, including a dangling symlink. Staging
          // is already complete and synchronized; never expose a partly written target.
          await link(staging as string, before.target.path);
          this.checkpoint("after_create_link");
          await unlink(staging as string);
          staging = undefined;
        } else {
          await rename(staging as string, before.target.path);
          staging = undefined;
        }
        // From publication onward, cancellation or a sync failure is an uncertain effect,
        // never evidence that nothing changed. The executor retains unknown on exceptions.
        this.checkpoint("after_publish");
        const parent = before.target.parents.at(-1) as Identity;
        this.guard();
        const directory = await open(
          parent.path,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          this.guard();
          const currentParent = await this.io(() => directory.stat());
          if (!same(parent.stat, currentParent))
            throw new WriteError("Parent changed after publication");
          await this.io(() => directory.sync());
        } finally {
          await directory.close();
        }
        this.checkpoint("after_parent_sync");
        const post = await this.read(mutation.path);
        if (!matches(post.version, afterHash, mutation.mode))
          throw new WriteError("Published file changed before verification");
        return {
          snapshotId: effect.id,
          path: mutation.path,
          beforeHash: before.version.sha256,
          afterHash,
        };
      } finally {
        // Cleanup is narrow and never follows a changed parent or removes another inode.
        // An abruptly killed process can leave a private staging file for manual cleanup.
        if (staging && stagingStat) {
          try {
            const parent = before.target.parents.at(-1) as Identity;
            const parentNow = await lstat(parent.path);
            const fileNow = await lstat(staging);
            if (
              same(parent.stat, parentNow) &&
              !parentNow.isSymbolicLink() &&
              same(stagingStat, fileNow)
            )
              await unlink(staging);
          } catch {
            /* Cleanup failure cannot turn an uncertain publication into success. */
          }
        }
      }
    });
  }
  private checkpoint(point: WriteCheckpoint): void {
    this.options.checkpoint?.(point);
    this.guard();
  }
}

function pathParts(input: string): readonly string[] {
  if (
    typeof input !== "string" ||
    !input.length ||
    input.length > 4096 ||
    input.includes("\0") ||
    input.includes("\\") ||
    isAbsolute(input)
  )
    throw new WriteError("Use a relative workspace file path");
  const parts = input.split("/");
  if (
    parts.some(
      (part) => !part.length || part === "." || part === ".." || part.startsWith(".moyyi-write-"),
    )
  )
    throw new WriteError("Use a normalized relative path without traversal or reserved names");
  return parts;
}
function change(value: unknown): WorkspaceChange {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WriteError("Invalid approved workspace change");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !["path", "expectedHash", "text", "mode", "restoreOf"].includes(key),
    )
  )
    throw new WriteError("Unsupported workspace change field");
  if (typeof data.path !== "string") throw new WriteError("Invalid file path");
  pathParts(data.path);
  if (
    data.expectedHash !== null &&
    (typeof data.expectedHash !== "string" || !hashPattern.test(data.expectedHash))
  )
    throw new WriteError("Invalid file hash");
  if (
    data.text !== null &&
    (typeof data.text !== "string" ||
      !data.text.isWellFormed() ||
      new TextEncoder().encode(data.text).byteLength > MAX_BYTES)
  )
    throw new WriteError("Expected bounded UTF-8 text");
  if (data.text !== null) decode(new TextEncoder().encode(data.text as string));
  if (
    data.mode !== null &&
    (typeof data.mode !== "number" ||
      !Number.isInteger(data.mode) ||
      data.mode < 0 ||
      data.mode > 0o777)
  )
    throw new WriteError("Invalid file permissions");
  if ((data.text === null) !== (data.mode === null))
    throw new WriteError("Absent files must have absent permissions");
  if (
    data.restoreOf !== undefined &&
    (typeof data.restoreOf !== "string" || !data.restoreOf.length || data.restoreOf.length > 512)
  )
    throw new WriteError("Invalid restore identifier");
  return {
    path: data.path,
    expectedHash: data.expectedHash as string | null,
    text: data.text as string | null,
    mode: data.mode as number | null,
    ...(data.restoreOf === undefined ? {} : { restoreOf: data.restoreOf as string }),
  };
}
function regular(stat: Stats): void {
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o7000) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new WriteError(
      "Writes require an owned ordinary file with one link and no special permissions",
    );
  if (stat.size > MAX_BYTES) throw new WriteError("Workspace text exceeds 1 MiB limit");
}
function decode(bytes: Uint8Array): string {
  if (
    bytes.byteLength > MAX_BYTES ||
    bytes.some((byte) => byte === 0 || (byte < 32 && ![9, 10, 12, 13].includes(byte)))
  )
    throw new WriteError("Only bounded UTF-8 text files are supported");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new WriteError("Only valid UTF-8 text files are supported");
  }
}
function matches(version: FileVersion, sha256: string | null, mode: number | null): boolean {
  return version.sha256 === sha256 && version.mode === mode;
}
function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function same(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function unchangedFile(left: Stats, right: Stats): boolean {
  return (
    same(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mode === right.mode &&
    left.nlink === right.nlink
  );
}
function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
