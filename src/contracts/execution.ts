import type { WorkspaceFiles } from "./files.ts";
import type { ActionDigest } from "./persisted/index.ts";
import type { JsonSchema, Precondition, ToolContext } from "./tools.ts";

export type ValidationResult =
  | { readonly valid: true; readonly value: unknown }
  | { readonly valid: false; readonly reason: string };

/** A trusted runtime adapter; schemas come from installed plugins, arguments from the model. */
export interface ArgumentValidator {
  validate(schema: JsonSchema, raw: string, maxBytes: number): ValidationResult;
}

export interface PreconditionVerifier {
  check(
    conditions: readonly Precondition[],
    context: ToolContext,
  ): Promise<{ readonly valid: true } | { readonly valid: false; readonly reason: string }>;
}

/** The executor supplies a live guard; the host must check it around every asynchronous I/O. */
export interface WorkspaceFilesFactory {
  create(context: ToolContext, assertAuthorized: () => void): WorkspaceFiles;
}

/** Time and hashing remain injected so core code has no package or I/O dependency. */
export interface Scheduler {
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  deadline(milliseconds: number, callback: () => void): () => void;
}

export interface ActionHasher {
  digest(value: unknown): ActionDigest;
}

export interface RunLimits {
  readonly maxModelRequests: number;
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxModelResponseBytes: number;
  readonly maxToolOutputBytes: number;
  readonly maxRetries: number;
  readonly maxParallelReads: number;
}
