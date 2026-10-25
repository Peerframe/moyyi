import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WorkspaceSnapshot, WorkspaceSnapshotStore } from "../contracts/files.ts";
import {
  type BlobRef,
  canTransition,
  type EffectId,
  type EffectRecord,
  type EntryId,
  isTerminal,
  PERSISTED_FORMAT_VERSION,
  type RunId,
  type SessionId,
  type TranscriptEntry,
} from "../contracts/persisted/index.ts";
import type {
  RunState,
  SessionSnapshot,
  SessionState,
  SessionStore,
  StoreBatch,
  WorkspaceLeaseChange,
} from "../contracts/ports.ts";
import { canonicalizeJson } from "../contracts/replay.ts";
import {
  acquireWriterLock,
  assertRegularFile,
  BlobStore,
  prepareDataDirectory,
  syncDirectory,
} from "./files.ts";
import { encodeEffect, encodeEntry, entryBlobRefs } from "./records.ts";
import { migrate, SCHEMA_VERSION } from "./schema.ts";
import { encodeSnapshot } from "./snapshots.ts";

export type StoreCheckpoint =
  | "migration:before_commit"
  | "commit:before_commit"
  | "snapshot:before_commit"
  | "backup:before_publish"
  | "backup:before_parent_sync";
export interface StoreOptions {
  readonly maxBlobBytes?: number;
  /** Trusted test fault injection only. Never sourced from plugins, models or stored data. */
  readonly checkpoint?: (point: StoreCheckpoint) => void;
}

/** Complete files are visible, but the final publication durability was not acknowledged. */
export class BackupDurabilityError extends Error {
  readonly destination: string;
  constructor(destination: string, cause: unknown) {
    super(
      `Backup was published at ${destination}, but final synchronization failed; durability is unconfirmed`,
      { cause },
    );
    this.name = "BackupDurabilityError";
    this.destination = destination;
  }
}

function id(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    throw new Error("Invalid record ID");
}

function workspace(path: string): string {
  if (!isAbsolute(path) || !statSync(path).isDirectory())
    throw new Error("Workspace must be an absolute directory");
  return realpathSync(path);
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

/** Local single-writer store. Opening it never resumes a run or executes an effect. */
export class SqliteSessionStore implements SessionStore, WorkspaceSnapshotStore {
  readonly directory: string;
  readonly #db: DatabaseSync;
  readonly #blobs: BlobStore;
  readonly #releaseLock: () => void;
  readonly #options: StoreOptions;
  #closed = false;
  #writing = false;

  constructor(directory: string, options: StoreOptions = {}) {
    this.#options = options;
    this.directory = prepareDataDirectory(directory);
    this.#releaseLock = acquireWriterLock(this.directory);
    let db: DatabaseSync | undefined;
    try {
      const file = join(this.directory, "data.sqlite");
      for (const name of [
        "data.sqlite",
        "data.sqlite-wal",
        "data.sqlite-shm",
        "data.sqlite-journal",
      ]) {
        const candidate = join(this.directory, name);
        if (existsSync(candidate) || lstatIfPresent(candidate)) assertRegularFile(candidate);
      }
      db = new DatabaseSync(file, { timeout: 0 });
      chmodSync(file, 0o600);
      db.exec(
        "PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA fullfsync = ON; PRAGMA trusted_schema = OFF",
      );
      migrate(db, () => options.checkpoint?.("migration:before_commit"));
      if (db.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode !== "wal")
        throw new Error("WAL is unavailable");
      if (db.prepare("PRAGMA synchronous").get()?.synchronous !== 2)
        throw new Error("FULL durability is unavailable");
      this.#db = db;
      this.#blobs = new BlobStore(this.directory, options.maxBlobBytes);
      syncDirectory(this.directory);
    } catch (error) {
      db?.close();
      this.#releaseLock();
      throw error;
    }
  }

  #ready(): void {
    if (this.#closed) throw new Error("Store is closed");
    if (this.#writing) throw new Error("Reentrant store operation");
  }

  close(): void {
    if (this.#closed) return;
    this.#ready();
    this.#db.close();
    this.#releaseLock();
    this.#closed = true;
  }

  diagnostics() {
    this.#ready();
    return {
      schemaVersion: SCHEMA_VERSION,
      persistedFormat: PERSISTED_FORMAT_VERSION,
      sqliteVersion: this.#db.prepare("SELECT sqlite_version() AS version").get()?.version,
      journalMode: this.#db.prepare("PRAGMA journal_mode").get()?.journal_mode,
      synchronous: this.#db.prepare("PRAGMA synchronous").get()?.synchronous,
      fullfsync: this.#db.prepare("PRAGMA fullfsync").get()?.fullfsync,
      integrity: this.#db.prepare("PRAGMA integrity_check").get()?.integrity_check,
    };
  }

  async putBlob(bytes: Uint8Array): Promise<BlobRef> {
    this.#ready();
    return this.#blobs.put(bytes);
  }

  async getBlob(ref: BlobRef): Promise<Uint8Array | null> {
    this.#ready();
    return this.#blobs.get(ref);
  }

  /** Persist recovery evidence with FULL durability before the host publishes a file change. */
  async saveSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
    this.#ready();
    const payload = encodeSnapshot(snapshot);
    this.#writing = true;
    let transaction = false;
    try {
      this.#db.exec("BEGIN IMMEDIATE");
      transaction = true;
      const authority = this.#db
        .prepare(`SELECT e.state, r.status, s.workspace_root,
        l.run_id AS lease_run FROM effects e JOIN runs r ON r.id = e.run_id
        JOIN sessions s ON s.id = r.session_id
        LEFT JOIN workspace_leases l ON l.workspace_root = s.workspace_root WHERE e.id = ?`)
        .get(snapshot.effectId);
      if (
        authority?.state !== "started" ||
        authority.status !== "active" ||
        authority.workspace_root !== snapshot.workspaceRoot ||
        authority.lease_run !== snapshot.runId
      )
        throw new Error(
          "Snapshot requires its started effect, active run and exclusive workspace lease",
        );
      this.#db
        .prepare(`INSERT INTO workspace_snapshots(id, effect_id, run_id, restore_of, payload)
        VALUES (?, ?, ?, ?, ?)`)
        .run(snapshot.id, snapshot.effectId, snapshot.runId, snapshot.restoreOf ?? null, payload);
      this.#snapshot(snapshot.id);
      this.#options.checkpoint?.("snapshot:before_commit");
      this.#db.exec("COMMIT");
      transaction = false;
    } catch (error) {
      if (transaction && this.#db.isTransaction) this.#db.exec("ROLLBACK");
      throw error;
    } finally {
      this.#writing = false;
    }
  }

  async getSnapshot(snapshotId: string): Promise<WorkspaceSnapshot | null> {
    this.#ready();
    id(snapshotId);
    return this.#snapshot(snapshotId);
  }

  async getSnapshotForEffect(effectId: EffectId): Promise<WorkspaceSnapshot | null> {
    return this.getSnapshot(effectId);
  }

  #decodeSnapshot(row: Record<string, unknown>): WorkspaceSnapshot {
    if (typeof row.payload !== "string") throw new Error("Invalid snapshot payload");
    const snapshot = JSON.parse(row.payload) as WorkspaceSnapshot;
    encodeSnapshot(snapshot);
    if (
      snapshot.id !== row.id ||
      snapshot.effectId !== row.effect_id ||
      snapshot.runId !== row.run_id ||
      (snapshot.restoreOf ?? null) !== row.restore_of
    )
      throw new Error("Snapshot columns disagree with its payload");
    const linked = this.#db
      .prepare(`SELECT e.payload, e.state AS effect_state, r.id AS run_id,
      s.workspace_root FROM effects e JOIN runs r ON r.id = e.run_id
      JOIN sessions s ON s.id = r.session_id WHERE e.id = ?`)
      .get(snapshot.effectId);
    if (
      !linked ||
      linked.run_id !== snapshot.runId ||
      linked.workspace_root !== snapshot.workspaceRoot
    )
      throw new Error("Snapshot effect/run/workspace identity does not match");
    const effect = JSON.parse(linked.payload as string) as EffectRecord;
    encodeEffect(effect);
    if (
      effect.id !== snapshot.effectId ||
      effect.runId !== snapshot.runId ||
      effect.state !== linked.effect_state ||
      effect.profile.class !== "workspace_write" ||
      effect.profile.reversibility !== "snapshot" ||
      !["started", "unknown", "succeeded", "failed"].includes(effect.state)
    )
      throw new Error(
        "Snapshot requires a started workspace-write effect with snapshot reversibility",
      );
    if (snapshot.beforeBlob !== null) this.#blobs.assert(snapshot.beforeBlob);
    return snapshot;
  }

  #snapshot(snapshotId: string): WorkspaceSnapshot | null {
    const row = this.#db.prepare("SELECT * FROM workspace_snapshots WHERE id = ?").get(snapshotId);
    if (!row) return null;
    const snapshot = this.#decodeSnapshot(row);
    if (snapshot.restoreOf !== undefined) {
      const source = this.#db
        .prepare("SELECT * FROM workspace_snapshots WHERE id = ?")
        .get(snapshot.restoreOf);
      if (!source || Number(source.ordinal) >= Number(row.ordinal))
        throw new Error("Snapshot restore source must be an earlier snapshot");
      const original = this.#decodeSnapshot(source);
      if (
        snapshot.workspaceRoot !== original.workspaceRoot ||
        snapshot.path !== original.path ||
        snapshot.beforeHash !== original.afterHash ||
        snapshot.beforeMode !== original.afterMode ||
        snapshot.afterHash !== original.beforeHash ||
        snapshot.afterMode !== original.beforeMode
      )
        throw new Error("Snapshot restore must reverse its source in the same workspace and path");
    }
    return snapshot;
  }

  /** Synchronous SQLite/filesystem operations cannot interleave at an await inside a commit. */
  async commit(batch: StoreBatch): Promise<void> {
    this.#ready();
    if (!["normal", "before_side_effect"].includes(batch.durability))
      throw new Error("Invalid durability label");
    this.#writing = true;
    let transaction = false;
    try {
      this.#db.exec("BEGIN IMMEDIATE");
      transaction = true;
      for (const session of batch.sessions ?? []) this.#session(session);
      // Close old runs first so the single-active-run index also permits an atomic handoff.
      for (const run of batch.runs ?? []) if (run.status !== "active") this.#run(run);
      for (const run of batch.runs ?? []) if (run.status === "active") this.#run(run);
      for (const entry of batch.entries) this.#entry(entry);
      for (const entry of batch.entries) this.#entryRelations(entry);
      for (const effect of batch.effects) this.#effect(effect);
      for (const lease of batch.leases ?? []) this.#lease(lease);
      this.#validateState();
      this.#options.checkpoint?.("commit:before_commit");
      this.#db.exec("COMMIT");
      transaction = false;
    } catch (error) {
      if (transaction && this.#db.isTransaction) this.#db.exec("ROLLBACK");
      throw error;
    } finally {
      this.#writing = false;
    }
  }

  #session(session: SessionState): void {
    id(session.sessionId);
    if (session.headEntryId !== null) id(session.headEntryId);
    const root = workspace(session.workspaceRoot);
    const previous = this.#db
      .prepare("SELECT workspace_root FROM sessions WHERE id = ?")
      .get(session.sessionId);
    if (previous && previous.workspace_root !== root)
      throw new Error("Session workspace is immutable");
    this.#db
      .prepare(`INSERT INTO sessions(id, workspace_root, head_entry_id) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET head_entry_id = excluded.head_entry_id`)
      .run(session.sessionId, root, session.headEntryId);
  }

  #run(run: RunState): void {
    id(run.runId);
    id(run.sessionId);
    if (!["active", "completed", "interrupted"].includes(run.status))
      throw new Error("Invalid run status");
    const previous = this.#db
      .prepare("SELECT session_id, status FROM runs WHERE id = ?")
      .get(run.runId);
    if (previous) {
      if (previous.session_id !== run.sessionId) throw new Error("Run session is immutable");
      if (previous.status !== run.status && previous.status !== "active")
        throw new Error("A finished run cannot be restarted");
    } else if (run.status !== "active") throw new Error("New runs must be active");
    this.#db
      .prepare(`INSERT INTO runs(id, session_id, status) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status`)
      .run(run.runId, run.sessionId, run.status);
  }

  #entry(entry: TranscriptEntry): void {
    const payload = encodeEntry(entry);
    for (const ref of entryBlobRefs(entry)) this.#blobs.assert(ref);
    const previous = this.#db.prepare("SELECT payload FROM entries WHERE id = ?").get(entry.id);
    if (previous) {
      if (previous.payload !== payload) throw new Error("Transcript entries are immutable");
      return;
    }
    this.#db
      .prepare(
        "INSERT INTO entries(id, session_id, parent_id, run_id, payload) VALUES (?, ?, ?, ?, ?)",
      )
      .run(entry.id, entry.sessionId, entry.parentId, entry.runId, payload);
  }

  #entryRelations(entry: TranscriptEntry): void {
    if (
      entry.runId !== null &&
      this.#db.prepare("SELECT session_id FROM runs WHERE id = ?").get(entry.runId)?.session_id !==
        entry.sessionId
    ) {
      throw new Error("Entry run belongs to another session");
    }
    const seen = new Set<string>([entry.id]);
    let parent = entry.parentId;
    while (parent !== null) {
      if (seen.has(parent)) throw new Error("Transcript cycle");
      seen.add(parent);
      const row = this.#db
        .prepare("SELECT session_id, parent_id FROM entries WHERE id = ?")
        .get(parent);
      if (!row || row.session_id !== entry.sessionId)
        throw new Error("Entry parent is missing or belongs to another session");
      parent = row.parent_id as EntryId | null;
    }
    if (entry.body.kind === "compaction") {
      const { fromEntryId, toEntryId } = entry.body.replaces;
      if (!seen.has(toEntryId) || toEntryId === entry.id)
        throw new Error("Compaction must replace an ancestor span");
      let cursor: string | null = toEntryId;
      while (cursor !== null && cursor !== fromEntryId) {
        cursor = this.#db.prepare("SELECT parent_id FROM entries WHERE id = ?").get(cursor)
          ?.parent_id as string | null;
      }
      if (cursor !== fromEntryId) throw new Error("Invalid compaction span");
    }
  }

  #effect(effect: EffectRecord): void {
    const payload = encodeEffect(effect);
    const row = this.#db.prepare("SELECT payload FROM effects WHERE id = ?").get(effect.id);
    if (row?.payload === payload) return;
    const run = this.#db.prepare("SELECT status FROM runs WHERE id = ?").get(effect.runId);
    if (!run) throw new Error("Effect run does not exist");
    if (row) {
      const previous = JSON.parse(row.payload as string) as EffectRecord;
      if (
        previous.runId !== effect.runId ||
        previous.callId !== effect.callId ||
        previous.tool !== effect.tool ||
        canonicalizeJson(previous.profile) !== canonicalizeJson(effect.profile)
      ) {
        throw new Error("Effect identity is immutable");
      }
      if (!canTransition(previous.state, effect.state))
        throw new Error("Illegal effect transition");
      if (previous.digest !== effect.digest && effect.state !== "awaiting_approval")
        throw new Error("Effect digest changed without re-approval");
      if (Date.parse(effect.updatedAt) < Date.parse(previous.updatedAt))
        throw new Error("Effect time moved backwards");
      if (
        run.status !== "active" &&
        ["intended", "awaiting_approval", "approved", "started"].includes(effect.state)
      ) {
        throw new Error("A finished run cannot start an effect");
      }
    } else if (effect.state !== "intended" || run.status !== "active")
      throw new Error("New effects require an active run and intended state");
    this.#db
      .prepare(`INSERT INTO effects(id, run_id, call_id, state, payload) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, payload = excluded.payload`)
      .run(effect.id, effect.runId, effect.callId, effect.state, payload);
  }

  #lease(change: WorkspaceLeaseChange): void {
    id(change.runId);
    let root: string;
    if (change.kind === "release") {
      if (!isAbsolute(change.workspaceRoot)) throw new Error("Workspace must be absolute");
      const held = this.#db
        .prepare("SELECT workspace_root FROM workspace_leases WHERE run_id = ?")
        .get(change.runId);
      // The saved canonical path remains an identity even after the workspace is moved/deleted.
      root = resolve(change.workspaceRoot);
      if (held?.workspace_root !== root) root = workspace(change.workspaceRoot);
    } else root = workspace(change.workspaceRoot);
    const previous = this.#db
      .prepare("SELECT run_id FROM workspace_leases WHERE workspace_root = ?")
      .get(root);
    if (change.kind === "release") {
      if (!previous || previous.run_id !== change.runId)
        throw new Error("Only the lease holder can release a workspace");
      this.#db.prepare("DELETE FROM workspace_leases WHERE workspace_root = ?").run(root);
    } else if (change.kind === "acquire") {
      const run = this.#db
        .prepare(
          "SELECT r.status, s.workspace_root FROM runs r JOIN sessions s ON s.id = r.session_id WHERE r.id = ?",
        )
        .get(change.runId);
      if (run?.status !== "active" || run.workspace_root !== root)
        throw new Error("Workspace lease requires its active run");
      if (previous && previous.run_id !== change.runId)
        throw new Error("Workspace is already leased");
      for (const lease of this.#db
        .prepare("SELECT workspace_root, run_id FROM workspace_leases")
        .all()) {
        const held = lease.workspace_root as string;
        if (lease.run_id !== change.runId && (inside(held, root) || inside(root, held))) {
          throw new Error("Overlapping workspace is already leased");
        }
      }
      this.#db
        .prepare("INSERT OR IGNORE INTO workspace_leases(workspace_root, run_id) VALUES (?, ?)")
        .run(root, change.runId);
    } else throw new Error("Invalid workspace lease operation");
  }

  #validateState(): void {
    if (
      this.#db
        .prepare(`SELECT s.id FROM sessions s LEFT JOIN entries e ON e.id = s.head_entry_id
      WHERE s.head_entry_id IS NOT NULL AND (e.id IS NULL OR e.session_id <> s.id) LIMIT 1`)
        .get()
    )
      throw new Error("Session head must belong to its session");
    if (
      this.#db
        .prepare(`SELECT l.run_id FROM workspace_leases l JOIN runs r ON r.id = l.run_id
      WHERE r.status = 'completed' LIMIT 1`)
        .get()
    )
      throw new Error("Completed runs must release their workspace lease");
    const completed = this.#db
      .prepare(
        "SELECT e.state FROM effects e JOIN runs r ON r.id = e.run_id WHERE r.status = 'completed'",
      )
      .all();
    if (completed.some((row) => !isTerminal(row.state as EffectRecord["state"])))
      throw new Error("Completed runs must settle all effects");
    const inFlight = this.#db
      .prepare(`SELECT e.payload, r.id AS run_id, s.workspace_root FROM effects e
      JOIN runs r ON r.id = e.run_id JOIN sessions s ON s.id = r.session_id WHERE e.state IN ('started', 'unknown')`)
      .all();
    for (const row of inFlight) {
      const effect = JSON.parse(row.payload as string) as EffectRecord;
      if (
        ["workspace_write", "process"].includes(effect.profile.class) &&
        this.#db
          .prepare("SELECT run_id FROM workspace_leases WHERE workspace_root = ?")
          .get(row.workspace_root as string)?.run_id !== row.run_id
      ) {
        throw new Error("Unsettled workspace effects require their exclusive lease");
      }
    }
  }

  async loadSession(sessionId: SessionId): Promise<SessionSnapshot | null> {
    this.#ready();
    id(sessionId);
    const row = this.#db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    if (!row) return null;
    const entries = this.#db
      .prepare("SELECT payload FROM entries WHERE session_id = ? ORDER BY ordinal")
      .all(sessionId)
      .map((row) => JSON.parse(row.payload as string) as TranscriptEntry);
    const effects = this.#db
      .prepare(
        "SELECT e.payload FROM effects e JOIN runs r ON r.id = e.run_id WHERE r.session_id = ? ORDER BY e.id",
      )
      .all(sessionId)
      .map((row) => JSON.parse(row.payload as string) as EffectRecord);
    // Validate records read from disk as well as writes. Opaque payload bytes remain uninterpreted.
    for (const entry of entries) {
      encodeEntry(entry);
      for (const ref of entryBlobRefs(entry)) this.#blobs.assert(ref);
    }
    for (const effect of effects) encodeEffect(effect);
    for (const snapshot of this.#db
      .prepare(`SELECT w.id FROM workspace_snapshots w
      JOIN runs r ON r.id = w.run_id WHERE r.session_id = ?`)
      .all(sessionId))
      this.#snapshot(snapshot.id as string);
    return {
      sessionId,
      workspaceRoot: row.workspace_root as string,
      headEntryId: row.head_entry_id as EntryId | null,
      entries,
      effects,
      runs: this.#db
        .prepare("SELECT id, status FROM runs WHERE session_id = ? ORDER BY id")
        .all(sessionId)
        .map((run) => ({
          runId: run.id as RunId,
          sessionId,
          status: run.status as RunState["status"],
        })),
      leases: this.#db
        .prepare(
          "SELECT l.* FROM workspace_leases l JOIN runs r ON r.id = l.run_id WHERE r.session_id = ? ORDER BY l.workspace_root",
        )
        .all(sessionId)
        .map((lease) => ({
          workspaceRoot: lease.workspace_root as string,
          runId: lease.run_id as RunId,
        })),
    };
  }

  async listSessions(): Promise<readonly SessionId[]> {
    this.#ready();
    return this.#db
      .prepare("SELECT id FROM sessions ORDER BY id")
      .all()
      .map((row) => row.id as SessionId);
  }

  async unsettledEffects(): Promise<readonly EffectRecord[]> {
    this.#ready();
    return this.#db
      .prepare("SELECT payload FROM effects ORDER BY id")
      .all()
      .map((row) => {
        const effect = JSON.parse(row.payload as string) as EffectRecord;
        encodeEffect(effect);
        return effect;
      })
      .filter((effect) => !isTerminal(effect.state));
  }

  /** Publish a self-contained snapshot; acknowledge only after the final directory sync. */
  async backup(destination: string): Promise<void> {
    this.#ready();
    const parent = realpathSync(dirname(resolve(destination)));
    const target = join(parent, basename(destination));
    if (inside(this.directory, target) || inside(target, this.directory) || lstatIfPresent(target))
      throw new Error("Backup must be a new directory outside the store");
    const staging = mkdtempSync(join(parent, ".moyyi-backup-"));
    chmodSync(staging, 0o700);
    this.#writing = true;
    try {
      // VACUUM INTO is a consistent SQLite snapshot and synchronizes output with FULL enabled.
      // No await occurs before publication, so this instance cannot commit while blobs are copied.
      const snapshot = join(staging, "data.sqlite");
      this.#db.prepare("VACUUM INTO ?").run(snapshot);
      chmodSync(snapshot, 0o600);
      const blobs = new BlobStore(staging, this.#options.maxBlobBytes);
      const refs = new Set<BlobRef>();
      for (const row of this.#db.prepare("SELECT payload FROM entries").all()) {
        const entry = JSON.parse(row.payload as string) as TranscriptEntry;
        encodeEntry(entry);
        for (const ref of entryBlobRefs(entry)) refs.add(ref);
      }
      for (const row of this.#db.prepare("SELECT id FROM workspace_snapshots").all()) {
        const snapshot = this.#snapshot(row.id as string);
        if (snapshot?.beforeBlob !== null && snapshot?.beforeBlob !== undefined)
          refs.add(snapshot.beforeBlob);
      }
      for (const ref of refs) {
        const bytes = this.#blobs.get(ref);
        if (bytes === null || blobs.put(bytes) !== ref)
          throw new Error("Backup references a missing blob");
      }
      syncDirectory(staging);
      this.#options.checkpoint?.("backup:before_publish");
      if (lstatIfPresent(target)) throw new Error("Backup destination already exists");
      renameSync(staging, target);
      try {
        this.#options.checkpoint?.("backup:before_parent_sync");
        syncDirectory(parent);
      } catch (error) {
        // Do not erase a complete snapshot or pretend rename can be rolled back durably.
        throw new BackupDurabilityError(target, error);
      }
    } finally {
      this.#writing = false;
      rmSync(staging, { recursive: true, force: true });
    }
  }
}

function lstatIfPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
