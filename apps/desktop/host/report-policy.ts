import type {
  EffectId,
  EffectProfile,
  PermissionPolicy,
  PolicyDecision,
  PreparedAction,
} from "moyyi/contracts";
import { WorkspaceWritePolicy } from "moyyi/runtime";

/** A picked destination permits one missing-file create, never edit, undo or another path. */
export class ReportPolicy implements PermissionPolicy {
  private readonly base: WorkspaceWritePolicy;
  private readonly target: string;
  constructor(target: string, askEachRead: boolean) {
    this.target = target;
    this.base = new WorkspaceWritePolicy({
      approval: "ask",
      requireApproval: askEachRead ? ["read", "list", "search", "read_document"] : [],
    });
  }
  revision(): number {
    return this.base.revision();
  }
  beforeContextRead(path: string, operation: "read" | "list" = "read"): PolicyDecision {
    return this.base.beforeContextRead(path, operation);
  }
  beforePrepare(tool: string, profile: EffectProfile, args: unknown): PolicyDecision {
    if (profile.class === "read") return this.base.beforePrepare(tool, profile, args);
    if (
      tool !== "create" ||
      profile.class !== "workspace_write" ||
      !args ||
      typeof args !== "object" ||
      (args as { path?: unknown }).path !== this.target
    )
      return {
        kind: "deny",
        reason: "Only a new report at the selected destination is authorized",
      };
    return this.base.beforePrepare(tool, profile, args);
  }
  beforeExecute(
    tool: string,
    profile: EffectProfile,
    action: PreparedAction,
    effectId: EffectId,
    args?: unknown,
  ): PolicyDecision {
    const prepared = this.beforePrepare(tool, profile, args);
    if (prepared.kind !== "allow") return prepared;
    if (profile.class !== "read") {
      const payload = action.payload as {
        path?: unknown;
        expectedHash?: unknown;
        restoreOf?: unknown;
        text?: unknown;
      } | null;
      if (
        !payload ||
        payload.path !== this.target ||
        payload.expectedHash !== null ||
        payload.restoreOf !== undefined ||
        typeof payload.text !== "string"
      )
        return { kind: "deny", reason: "The prepared action is not the selected new report" };
    }
    return this.base.beforeExecute(tool, profile, action, effectId, args);
  }
}
