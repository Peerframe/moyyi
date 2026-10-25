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
