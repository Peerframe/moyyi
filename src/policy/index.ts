import type {
  EffectId,
  EffectProfile,
  PermissionPolicy,
  PolicyDecision,
  PreparedAction,
} from "../contracts/index.ts";

export interface ReadOnlyPolicyOptions {
  readonly readAllowed?: boolean;
  readonly requireApproval?: readonly string[];
}

/** Runtime-owned read grant; model arguments and plugin profiles never widen it. */
export class ReadOnlyPolicy implements PermissionPolicy {
  private allowed: boolean;
  private epoch = 0;
  private readonly approvalTools: ReadonlySet<string>;

  constructor(options: ReadOnlyPolicyOptions = {}) {
    this.allowed = options.readAllowed ?? true;
    this.approvalTools = new Set(options.requireApproval ?? []);
  }

  grant(): void {
    this.allowed = true;
    this.epoch++;
  }
  revoke(): void {
    this.allowed = false;
    this.epoch++;
  }
  revision(): number {
    return this.epoch;
  }

  beforePrepare(tool: string, profile: EffectProfile, _args: unknown): PolicyDecision {
    return this.decide(tool, profile, false);
  }

  beforeExecute(
    tool: string,
    profile: EffectProfile,
    _action: PreparedAction,
    _effectId: EffectId,
    _args?: unknown,
  ): PolicyDecision {
    return this.decide(tool, profile, true);
  }

  private decide(tool: string, profile: EffectProfile, prepared: boolean): PolicyDecision {
    if (profile.class !== "read") return { kind: "deny", reason: "Only read effects are enabled" };
    if (!this.allowed) return { kind: "deny", reason: "Read permission has been revoked" };
    // Preparation itself is read-only under the read grant; approval needs its resulting digest.
    return { kind: prepared && this.approvalTools.has(tool) ? "ask" : "allow" };
  }
}

/** Explicit host opt-in. The runtime capability separately enforces the selected workspace roots. */
export class WorkspaceWritePolicy implements PermissionPolicy {
  private readonly reads: ReadOnlyPolicy;
  private allowed = true;
  private epoch = 0;
  private readonly approval: "ask" | "allow";

  constructor(options: ReadOnlyPolicyOptions & { readonly approval?: "ask" | "allow" } = {}) {
    this.reads = new ReadOnlyPolicy(options);
    this.approval = options.approval ?? "ask";
    if (!["ask", "allow"].includes(this.approval)) throw Error("Invalid workspace approval mode");
  }
  revoke(): void {
    this.allowed = false;
    this.epoch++;
  }
  grant(): void {
    this.allowed = true;
    this.epoch++;
  }
  revision(): number {
    return this.epoch;
  }
  beforePrepare(tool: string, profile: EffectProfile, args: unknown): PolicyDecision {
    if (profile.class === "read") return this.reads.beforePrepare(tool, profile, args);
    if (!this.allowed) return { kind: "deny", reason: "Workspace write grant was revoked" };
    const read = this.reads.beforePrepare(
      tool,
      { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
      args,
    );
    if (read.kind !== "allow") return read;
    if (
      profile.class !== "workspace_write" ||
      profile.reversibility !== "snapshot" ||
      profile.verification !== "postcheck"
    )
      return { kind: "deny", reason: "Only snapshot-backed workspace writes are enabled" };
    return { kind: "allow" };
  }
  beforeExecute(
    tool: string,
    profile: EffectProfile,
    action: PreparedAction,
    effectId: EffectId,
    args?: unknown,
  ): PolicyDecision {
    if (profile.class === "read")
      return this.reads.beforeExecute(tool, profile, action, effectId, args);
    const prepared = this.beforePrepare(tool, profile, args);
    return prepared.kind === "allow" ? { kind: this.approval } : prepared;
  }
}
