import type {
  EffectId,
  EffectProfile,
  PermissionPolicy,
  PolicyDecision,
  PreparedAction,
} from "moyyi/contracts";
import { ReadOnlyPolicy, WorkspaceProcessPolicy, WorkspaceWritePolicy } from "moyyi/runtime";
import type { DesktopPermissions } from "../shared.ts";
import { ReportPolicy } from "./report-policy.ts";

export const MAX_APPROVAL_PREVIEW = 131_072;

/** The entire prepared proposal must fit the view before its digest can be approved. */
export class DesktopPolicy implements PermissionPolicy {
  private readonly base: PermissionPolicy;
  constructor(permissions: DesktopPermissions, askEachRead: boolean, report: string | null) {
    const reads = {
      requireApproval: askEachRead ? ["read", "list", "search", "read_document"] : [],
    };
    const files = permissions.writes
      ? new WorkspaceWritePolicy({ ...reads, approval: "ask" })
      : report
        ? new ReportPolicy(report, askEachRead)
        : new ReadOnlyPolicy(reads);
    this.base = permissions.checks ? new WorkspaceProcessPolicy({ files, approval: "ask" }) : files;
  }
  revision(): number {
    return this.base.revision?.() ?? 0;
  }
  beforeContextRead(path: string, operation: "read" | "list" = "read"): PolicyDecision {
    return (
      this.base.beforeContextRead?.(path, operation) ?? {
        kind: "deny",
        reason: "Context read unavailable",
      }
    );
  }
  beforePrepare(tool: string, profile: EffectProfile, args: unknown): PolicyDecision {
    return this.base.beforePrepare(tool, profile, args);
  }
  beforeExecute(
    tool: string,
    profile: EffectProfile,
    action: PreparedAction,
    effectId: EffectId,
    args?: unknown,
  ): PolicyDecision {
    if (action.preview !== undefined && action.preview.length > MAX_APPROVAL_PREVIEW)
      return {
        kind: "deny",
        reason:
          "The complete action preview exceeds the desktop display limit; use a smaller file or operation",
      };
    return this.base.beforeExecute(tool, profile, action, effectId, args);
  }
}
