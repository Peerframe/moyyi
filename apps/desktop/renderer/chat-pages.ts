import type { PageBlock, PluginPage, SettingsPage } from "../../chat/port.ts";
import type { DesktopState } from "../shared.ts";
import { permissionLabel } from "./effects-state.ts";

const controls = (...items: readonly [string, string][]): PageBlock => ({
  kind: "controls",
  controls: items.map(([id, label]) => ({ id, label })),
});

export function chatModelLabel(state: DesktopState): string {
  return state.model
    ? `${state.model.provider} · ${state.model.model}`
    : { flash: "DeepSeek Flash", "kimi-cn": "Kimi 中国站", "kimi-global": "Kimi 国际站" }[
        state.settings.preset
      ];
}

export function chatBudgetLabel(state: DesktopState): string {
  const requests = state.budgets.maxRequests;
  const timeout = state.budgets.timeoutMs;
  return [
    requests === null ? "请求上限未提供" : `每轮最多 ${requests} 次模型请求`,
    timeout === null ? "时限未提供" : `时限 ${timeout / 1000} 秒`,
  ].join(" · ");
}

/** Long-task switches as saved; each is off unless stored (ADR 0049, 0051, 0052). */
export function longTaskLabel(state: DesktopState): string {
  const on = [
    state.settings.autoCompact ? "自动压缩上下文" : null,
    state.settings.subagents ? "只读子 agent" : null,
    state.settings.nestedInstructions ? "子目录 AGENTS.md" : null,
  ].filter(Boolean);
  return on.length ? `已开启 ${on.join("、")}` : "全部关闭";
}

/** Page actions open the existing complete controls; they never change authority themselves. */
export function projectChatPages(state: DesktopState): {
  readonly settings: readonly SettingsPage[];
  readonly plugins: readonly PluginPage[];
} {
  const active = Boolean(state.activeSessionId && !state.historyOnly);
  const permission = state.historyOnly
    ? "当前只能查看历史，不能继续任务。"
    : state.activeSessionId
      ? permissionLabel(state.permissions, state.reportTarget, state.webAccess)
      : "选择工作目录后，以只读权限开始。";
  const model = chatModelLabel(state);
  const settings: SettingsPage[] = [
    {
      id: "models",
      name: "模型和密钥",
      icon: "key",
      summary: model,
      groups: [
        {
          blocks: [
            {
              kind: "lines",
              lines: [
                { id: "model.current", text: model, sub: `配置：${state.settings.preset}` },
                {
                  id: "model.connection",
                  text: state.connection.ready ? "本机配置已就绪" : "模型配置未就绪",
                  sub:
                    state.connection.message ??
                    "本机配置状态不代表已验证远端连接；实际请求结果会保留在会话中。",
                },
              ],
            },
            { kind: "note", text: "API Key 通过模型设置写入 macOS 钥匙串，不显示在聊天中。" },
            controls(["native.settings", "打开模型设置"]),
          ],
        },
      ],
    },
    {
      id: "budget",
      name: "预算",
      icon: "gauge",
      summary: chatBudgetLabel(state),
      groups: [
        {
          blocks: [
            {
              kind: "lines",
              lines: [
                {
                  id: "budget.requests",
                  text: `设置的请求上限：每轮 ${state.settings.maxRequests} 次`,
                  sub: `设置的时限：${state.settings.timeoutMs / 1000} 秒`,
                },
                {
                  id: "budget.long",
                  text: `长任务开关：${longTaskLabel(state)}`,
                  sub: "在模型设置中开关；保存后对新运行生效。",
                },
                {
                  id: "budget.output",
                  text:
                    state.budgets.maxOutputTokens === null
                      ? "输出 token 上限未提供"
                      : `输出上限：${state.budgets.maxOutputTokens} tokens`,
                  sub: "这里只显示上限，不推断已经使用的请求数或费用。",
                },
              ],
            },
            controls(["native.settings", "调整模型与预算"]),
          ],
        },
      ],
    },
    {
      id: "permissions",
      name: "权限和确认",
      icon: "shield",
      summary: permission,
      groups: [
        {
          blocks: [
            { kind: "note", text: state.workspaceRoot ?? "当前没有打开工作目录。" },
            { kind: "note", text: permission },
            {
              kind: "locks",
              lines: [
                "重开会话会关闭文件修改、命令检查和网页访问权限。",
                "审批只针对显示的具体操作；停止不会撤销已经完成的修改。",
                "「本会话始终允许」只在当前会话内对同一工具（命令须完全相同）不再询问，重开会话即失效。",
                "计划模式下修改、命令和外部调用一律拒绝，不弹出审批；更改权限不会关闭计划模式。",
              ],
            },
            controls(["native.permissions", "工作目录权限"], ["native.web", "网页访问权限"]),
          ],
        },
      ],
    },
    {
      id: "records",
      name: "记录和数据",
      icon: "db",
      summary: "本机会话、材料、成果与备份",
      groups: [
        {
          title: "当前会话",
          blocks: [
            {
              kind: "note",
              text: state.activeSessionId
                ? `已选择 ${state.materials.length} 份材料；当前成果页有 ${state.artifacts.items.length} 项${state.artifacts.hasMore ? "，还有更多" : ""}。`
                : "先打开或新建一个会话，再查看材料与成果。",
            },
            controls(
              ["native.history", "完整历史"],
              ["native.materials", "材料库"],
              ["native.artifacts", "报告与成果"],
              ["native.effects", "操作与撤销"],
            ),
          ],
        },
        {
          title: "本机数据",
          blocks: [
            controls(
              ["native.sessions", "管理会话"],
              ["native.new", "新建会话"],
              ["native.maintenance", "备份与回退"],
            ),
            { kind: "note", text: "备份保留会话与数据型设置，不导出钥匙串密钥。" },
          ],
        },
      ],
    },
    {
      id: "about",
      name: "关于 moyyi",
      icon: "info",
      summary: "本地桌面应用",
      groups: [
        {
          blocks: [
            { kind: "brand", tagline: "moyyi · 墨一" },
            {
              kind: "note",
              text: "当前聊天连接本机 moyyi 运行时。消息、操作与结果以会话记录和回执为准。",
            },
          ],
        },
      ],
    },
  ];
  const plugins: PluginPage[] = [
    {
      id: "files",
      name: "文件",
      icon: "folder",
      enabled: active,
      summary: active ? permission : "打开工作目录后可用",
      groups: [
        {
          blocks: [
            { kind: "note", text: "读取所选工作目录。文件修改需要当前会话权限与逐次审批。" },
            controls(["native.permissions", "查看工作目录权限"]),
          ],
        },
      ],
    },
    {
      id: "shell",
      name: "命令检查",
      icon: "term",
      enabled: active && state.permissions.checks,
      summary: active && state.permissions.checks ? "当前会话允许提议检查，逐次审批" : "当前未授权",
      groups: [
        {
          blocks: [
            { kind: "note", text: "使用附带的 Node，在只读工作目录、无网络的原生沙箱中检查。" },
            controls(["native.permissions", "配置命令检查权限"]),
          ],
        },
      ],
    },
    {
      id: "web",
      name: "网页",
      icon: "globe",
      enabled: active && state.webAccess.allowedOrigins.length > 0,
      summary:
        active && state.webAccess.allowedOrigins.length > 0
          ? `当前允许 ${state.webAccess.allowedOrigins.length} 个来源，逐次审批`
          : "当前未授权网页访问",
      groups: [
        {
          blocks: [
            {
              kind: "note",
              text: state.webAccess.allowedOrigins.join("\n") || "未选择允许访问的 HTTPS 来源。",
            },
            controls(["native.web", "配置网页访问"]),
          ],
        },
      ],
    },
    {
      id: "documents",
      name: "材料与文档",
      icon: "doc",
      enabled: active,
      summary: `当前选择 ${state.materials.length} 份材料`,
      groups: [
        {
          blocks: [
            {
              kind: "note",
              text: "通过本机文件选择器导入材料。文档读取正文；图片可预览，目前不发送给模型。",
            },
            controls(["native.materials", "打开材料库"]),
          ],
        },
      ],
    },
  ];
  return { settings, plugins };
}
