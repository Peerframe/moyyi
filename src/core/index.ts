import type {
  Clock,
  ContextBuilder,
  IdSource,
  ModelClient,
  ModelProfile,
  PermissionPolicy,
  SessionStore,
  ToolDefinition,
} from "../contracts/index.ts";

/**
 * The agent core: run loop, tool scheduling, approvals, budgets, cancellation, error
 * classification, retries and recovery. It performs no I/O of its own; everything external
 * arrives through these ports, which keeps every behavior reproducible with fakes.
 *
 * Not implemented yet; see docs/roadmap.md, phase 1.
 */
export interface CoreDeps {
  readonly model: ModelClient;
  readonly profile: ModelProfile;
  readonly tools: readonly ToolDefinition[];
  readonly store: SessionStore;
  readonly context: ContextBuilder;
  readonly policy: PermissionPolicy;
  readonly clock: Clock;
  readonly ids: IdSource;
}
