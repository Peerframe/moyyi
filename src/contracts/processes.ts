import type { ToolContext } from "./tools.ts";

/** Exact shell input; the host supplies the backend, environment and network policy. */
export interface ProcessRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Keep running after the call returns; read with shell_output, end with shell_stop. */
  readonly background?: boolean;
}

/** Host-normalized proposal bound into the action digest. */
export interface PreparedProcess extends ProcessRequest {
  readonly workspaceRoot: string;
  /** Host-selected filesystem mode, bound to approval and never supplied by the tool caller. */
  readonly workspaceAccess: "read-only" | "read-write";
  /** Opaque host identity, rechecked after approval to reject replaced directories. */
  readonly directoryIdentity: string;
  readonly backend: "seatbelt" | "bubblewrap";
}

export interface ProcessResult {
  readonly termination:
    | "exited"
    | "cancelled"
    | "timeout"
    | "output_limit"
    | "revoked"
    | "unknown"
    | "background";
  readonly exitCode: number | null;
  readonly output: string;
  readonly truncated: boolean;
  /** Present when the command was started in the background. */
  readonly handle?: string;
}

/** Bounded view of a background command; output is what arrived since the previous read. */
export interface BackgroundProcessView {
  readonly handle: string;
  readonly command: string;
  readonly state: "running" | "exited" | "stopped" | "timeout" | "revoked" | "unknown";
  readonly exitCode: number | null;
  readonly output: string;
  /** Output that was produced but is no longer retained, before this read's text. */
  readonly droppedBytes: number;
  /** More unread output remains after this read. */
  readonly more: boolean;
}

/** Session-bound access to background commands; supplied only to shell_output and shell_stop. */
export interface BackgroundProcessAccess {
  output(handle: string, maxBytes: number): Promise<BackgroundProcessView>;
  stop(handle: string): Promise<BackgroundProcessView>;
}

export interface BackgroundProcessAccessFactory {
  create(context: ToolContext, assertAuthorized: () => void): BackgroundProcessAccess;
}

/** Execution has no arguments: it can only run the executor-approved proposal once. */
export interface WorkspaceProcesses {
  prepare(request: ProcessRequest): Promise<PreparedProcess>;
  run(): Promise<ProcessResult>;
}
