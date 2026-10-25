import type { BlobRef, EffectId, RunId } from "./persisted/index.ts";
import type { ReconcileOutcome } from "./tools.ts";

/** Read-only, runtime-confined capabilities. Paths are relative to the selected workspace. */
export interface WorkspaceFiles {
  read(path: string, options?: FileReadOptions): Promise<FileRead>;
  list(path: string, options?: { readonly maxEntries?: number }): Promise<FileList>;
  search(
    path: string,
    query: string,
    options?: {
      readonly maxMatches?: number;
      readonly caseSensitive?: boolean;
      /** Nearby LF-delimited lines per side, 0–20. Capability default 0; fs tool default 8. */
      readonly contextLines?: number;
    },
  ): Promise<FileSearch>;
}

export interface FileReadOptions {
  readonly maxBytes?: number;
  /** Supplying either line option selects an LF-delimited range; defaults are 1 and 200. */
  readonly startLine?: number;
  readonly maxLines?: number;
}

export interface FileRead {
  readonly path: string;
  readonly text: string;
  readonly bytesRead: number;
  readonly truncated: boolean;
  /** Present only for range reads. Completeness concerns the selected range, not the whole file. */
  readonly lineRange?: {
    readonly startLine: number;
    readonly endLine: number | null;
    readonly complete: boolean;
  };
}

export interface FileList {
  readonly path: string;
  readonly entries: readonly {
    readonly path: string;
    readonly type: "file" | "directory" | "symlink";
  }[];
  readonly truncated: boolean;
  readonly skippedEntries: number;
}

export interface FileSearch {
  readonly path: string;
  readonly matches: readonly {
    readonly path: string;
    readonly line: number;
    readonly text: string;
  }[];
  /** Exact merged source windows, when requested; never a claim that a function is complete. */
  readonly context?: readonly FileSearchContext[];
  /** True when any scan, file-size, line-size, context or result bound omitted evidence. */
  readonly truncated: boolean;
  readonly skippedFiles: number;
}

export interface FileSearchContext {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  /** All requested nearby lines available, or a verified file edge; not semantic completeness. */
  readonly complete: boolean;
}

/** A complete, bounded UTF-8 file, or an absent target. Never a truncated read. */
export interface FileVersion {
  readonly path: string;
  readonly text: string | null;
  readonly sha256: string | null;
  readonly mode: number | null;
}

/** The exact mutation bound into the executor's action digest. null text removes a created file. */
export interface WorkspaceChange {
  readonly path: string;
  readonly expectedHash: string | null;
  readonly text: string | null;
  readonly mode: number | null;
  readonly restoreOf?: string;
}

export interface WorkspaceWriteReceipt {
  readonly snapshotId: string;
  readonly path: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}

/** apply has no arguments: only the already approved payload may change the workspace. */
export interface WorkspaceWrites {
  inspect(path: string): Promise<FileVersion>;
  inspectUndo(snapshotId: string): Promise<WorkspaceChange>;
  apply(): Promise<WorkspaceWriteReceipt>;
  /** Read-only postcondition inspection, bound to the recovering effect by runtime. */
  reconcile(): Promise<ReconcileOutcome>;
}

/** Additive SQLite schema-v2 data; transcript/effect JSON remains frozen at v1. */
export interface WorkspaceSnapshot {
  readonly version: 1;
  readonly id: string;
  readonly effectId: EffectId;
  readonly runId: RunId;
  readonly workspaceRoot: string;
  readonly path: string;
  readonly beforeBlob: BlobRef | null;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly beforeMode: number | null;
  readonly afterMode: number | null;
  readonly restoreOf?: string;
}

/** Snapshots are immutable and durable before publication; no workspace mutation is done here. */
export interface WorkspaceSnapshotStore {
  saveSnapshot(snapshot: WorkspaceSnapshot): Promise<void>;
  getSnapshot(id: string): Promise<WorkspaceSnapshot | null>;
  getSnapshotForEffect(effectId: EffectId): Promise<WorkspaceSnapshot | null>;
  putBlob(bytes: Uint8Array): Promise<BlobRef>;
  getBlob(ref: BlobRef): Promise<Uint8Array | null>;
}
