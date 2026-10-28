/* Long-list folding adapted from OpenBot TaskSteps.tsx at
 * 010439bb9002fabb7e1facd8450ee85edbafa309. Copyright (c) 2026 OpenBot contributors.
 * MIT; see OPENBOT-LICENSE.txt. Rows here are recorded effects, never inferred task stages. */
import type {
  DesktopEffect,
  DesktopPermissions,
  DesktopState,
  DesktopWebAccess,
} from "../shared.ts";

export function visibleEffects(items: readonly DesktopEffect[], expanded: boolean) {
  return expanded || items.length <= 12 ? items : [...items.slice(0, 3), ...items.slice(-6)];
}

export function effectsPageIdentity(sessionId: string, page: DesktopState["effects"]): string {
  return JSON.stringify([
    sessionId,
    page.offset,
    page.items.map((effect) => [effect.runId, effect.effectId]),
  ]);
}

export function undoDraft(effect: DesktopEffect): string | null {
  if (effect.state !== "succeeded" || effect.receipt?.kind !== "file") return null;
  return `请撤销这次已记录的文件操作：${JSON.stringify({
    path: effect.receipt.path,
    snapshotId: effect.receipt.snapshotId,
  })}。先核对当前文件与快照条件，再通过 undo 提议撤销；等待我的逐次批准。如果文件或权限已变化，请停止并说明，不要强制覆盖。`;
}

export const CHECK_DRAFT =
  "请检查当前修改是否满足我的要求。先读取项目中已有的检查说明，选择当前环境支持的 Node 检查，在只读工作目录、无网络的沙箱内提议执行并等待我的批准。不要安装依赖、写文件或把退出码 0 当成需求已全部满足；报告实际检查结果与未检查项。";

export function appendReviewDraft(current: string, addition: string): string {
  return current.trim() ? `${current}\n\n${addition}` : addition;
}

export function permissionLabel(
  permissions: DesktopPermissions,
  reportTarget: string | null,
  webAccess?: DesktopWebAccess,
) {
  const web = webAccess?.allowedOrigins.length
    ? `网页读取限 ${webAccess.allowedOrigins.length} 个来源，逐次批准（${webAccess.dns === "system" ? "系统 DNS" : "Cloudflare DoH"}）`
    : "不访问网页";
  if (reportTarget) return `可读工作目录；仅可审批创建报告：${reportTarget} · 不执行命令、${web}`;
  return [
    permissions.writes ? "工作目录文件修改需逐次批准" : "工作目录文件只读",
    permissions.checks ? "Node 命令检查需逐次批准（目录只读、无网络）" : "不执行命令",
    web,
  ].join(" · ");
}

export function inspectionLabel(state: string): string {
  return (
    {
      current: "本次检查的文件字节与回执一致",
      absent: "本次检查文件不存在，与撤销后的回执一致",
      changed: "当前文件已变化，与回执不一致；请先核对",
      missing: "预期文件未找到，可能已移动或删除",
      unavailable: "当前无法安全检查文件，不能确认结果",
    }[state] ?? "当前检查结果未知"
  );
}

export function processTerminationLabel(termination: string): string {
  return (
    {
      exited: "命令已退出",
      cancelled: "已取消",
      timeout: "已达到命令时限",
      output_limit: "输出达到上限",
      revoked: "权限已撤销",
      unknown: "执行结果未知",
    }[termination] ?? "终止状态未知"
  );
}
