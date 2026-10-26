import type { WorkspaceDocuments } from "./documents.ts";
import type { WorkspaceFiles, WorkspaceWrites } from "./files.ts";
import type {
  ActionDigest,
  EffectProfile,
  EffectRecord,
  ImagePart,
  RunId,
  TextPart,
  ToolResultStatus,
} from "./persisted/index.ts";
import type { WorkspaceProcesses } from "./processes.ts";
import type { WebAccess } from "./web.ts";

/** JSON Schema as sent to models; it is the single source of truth for tool arguments. */
export type JsonSchema = { readonly [key: string]: unknown };

/**
 * A tool is split into phases so the executor, not the tool, owns policy:
 * validate (schema) -> prepare (read-only; needs read permission) -> approve (bound to digest)
 * -> recheck preconditions -> execute -> settle.
 */
export interface ToolDefinition<Args = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly effect: EffectProfile;
  /** Read-only. Resolves targets and computes the preview and preconditions. */
  prepare(args: Args, ctx: ToolContext): Promise<PreparedAction>;
  /** Must check `action.preconditions` again immediately before changing anything. */
  execute(action: PreparedAction, ctx: ToolContext): Promise<ToolOutcome>;
  /** Inspects the world after a crash to resolve an `unknown` effect. */
  reconcile?(record: EffectRecord, ctx: ToolContext): Promise<ReconcileOutcome>;
}

export interface PreparedAction {
  /** Proposal from prepare; the executor binds the full action/arguments with its own hash. */
  readonly digest: ActionDigest;
  /** Human-readable summary shown in approvals. */
  readonly summary: string;
  /** e.g. a unified diff or the exact command line. */
  readonly preview?: string;
  /** Facts that must still hold at execution time, e.g. a file's content hash. */
  readonly preconditions: readonly Precondition[];
  /** Tool-private, serializable data needed by `execute`. */
  readonly payload: unknown;
}

export type Precondition =
  | { readonly kind: "file_hash"; readonly path: string; readonly sha256: string | null }
  | { readonly kind: "path_resolves_within"; readonly path: string; readonly root: string };

export interface ToolOutcome {
  readonly status: Extract<ToolResultStatus, "succeeded" | "failed">;
  readonly content: readonly (TextPart | ImagePart)[];
  readonly evidence?: string;
}

export type ReconcileOutcome =
  | { readonly resolved: true; readonly status: "succeeded" | "failed"; readonly evidence: string }
  | { readonly resolved: false; readonly reason: string };

/**
 * Capabilities handed to a tool. Tools never reach the store, the model or the policy.
 *
 * Runtime-confined read capabilities expire when the current prepare/execute call ends.
 * Built-in plugins may not import node:fs or node:child_process. Process access remains gated.
 */
export interface ToolContext {
  readonly runId: RunId;
  readonly workspaceRoot: string;
  readonly signal: AbortSignal;
  /** Output limits the tool must enforce; oversized output is truncated, not dropped. */
  readonly limits: { readonly maxOutputBytes: number };
  /** Absent in hosts without file support; never fall back to direct host access. */
  readonly files?: WorkspaceFiles;
  /** Fixed offline extraction, only during read_document execution under the read grant. */
  readonly documents?: WorkspaceDocuments;
  /** Runtime binds apply to the current approved action; unavailable to read tools. */
  readonly writes?: WorkspaceWrites;
  /** A scoped, sandboxed process; absent without a separate explicit host grant. */
  readonly processes?: WorkspaceProcesses;
  /** Separate outbound tool grant; never includes provider credentials or local file access. */
  readonly web?: WebAccess;
}
