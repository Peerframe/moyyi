/** Exact shell input; the host supplies the backend, environment and network policy. */
export interface ProcessRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
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
  readonly termination: "exited" | "cancelled" | "timeout" | "output_limit" | "revoked" | "unknown";
  readonly exitCode: number | null;
  readonly output: string;
  readonly truncated: boolean;
}

/** Execution has no arguments: it can only run the executor-approved proposal once. */
export interface WorkspaceProcesses {
  prepare(request: ProcessRequest): Promise<PreparedProcess>;
  run(): Promise<ProcessResult>;
}
