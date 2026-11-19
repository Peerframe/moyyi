import type { Control, PageBlock, PluginPage, SettingsPage } from "../../chat/port.ts";
import { shortcutsPage } from "../../chat/ui/shortcuts.ts";
import type { DesktopSettings, DesktopState } from "../shared.ts";
import { type ChatAppearance, DEFAULT_APPEARANCE, generalSettingsPage } from "./chat-appearance.ts";
import { aboutPage, helpPage, memoryPage, personalPage } from "./chat-settings-info.ts";
import { permissionLabel } from "./effects-state.ts";
import { presetLabel } from "./view-state.ts";

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

/** The model card's key field and choices; the port maps them onto `configure`. */
export const modelFieldId = (preset: DesktopSettings["preset"]) => `native.model.${preset}`;
export const NATIVE_PRESET = "native.preset";
export const NATIVE_KIMI_EFFORT = "native.kimiEffort";
export const PRESETS: readonly DesktopSettings["preset"][] = ["flash", "kimi-cn", "kimi-global"];
export const KIMI_EFFORTS = ["low", "high"] as const;

const GUARANTEE = "这些是 moyyi 的保证，设置里关不掉。";
/** Keep page controls and their dispatch guard in agreement as the session changes. */
export function nativeControlReason(
  state: DesktopState,
  id: string,
  pending: boolean,
): string | undefined {
  if (state.status !== "ready") return "本地服务尚未就绪。";
  const needsSession = [
    "native.history",
    "native.permissions",
    "native.web",
    "native.materials",
    "native.artifacts",
    "native.effects",
  ].includes(id);
  if (needsSession && !state.activeSessionId) return "先打开一个会话。";
  if (needsSession && state.historyOnly && id !== "native.history") return "这个会话只能查看历史。";
  const viewOnly = [
    "native.materials",
    "native.artifacts",
    "native.effects",
    "native.help",
  ].includes(id);
  if (!viewOnly && (pending || state.run || state.importing))
    return "请先等待当前操作结束，或停止运行。";
  return undefined;
}

function modelsPage(state: DesktopState, disabledReason: string | undefined): SettingsPage {
  const blocked = disabledReason ? { disabledReason } : {};
  const { preset } = state.settings;
  const name = presetLabel(preset);
  const ready = state.connection.ready;
  return {
    id: "models",
    name: "模型",
    icon: "key",
    section: "功能",
    summary: `${name} · ${ready ? "密钥已就绪" : "连接未就绪"}`,
    sub: "AI 通过这个连接找模型。密钥只进 macOS 钥匙串，不会出现在聊天、记录和 AI 看到的内容里；保存不发模型请求。",
    groups: [
      {
        title: "连接",
        blocks: [
          {
            kind: "providers",
            providers: [
              {
                id: modelFieldId(preset),
                letter: preset === "flash" ? "D" : "K",
                name,
                tag: "已选",
                connectionLabel: ready ? "本机密钥已就绪" : "连接未就绪",
                connected: ready,
                status: ready
                  ? "密钥在系统钥匙串里 · 保存时不验证远端连接"
                  : (state.connection.message ?? "还没连上：粘贴这家的密钥"),
                controls: [],
                keyField: {
                  placeholder: ready ? `换一把 ${name} 的密钥` : `粘贴 ${name} 的密钥`,
                  save: {
                    ...blocked,
                    id: `${modelFieldId(preset)}.save`,
                    label: "存进钥匙串",
                    tone: "primary",
                  },
                },
              },
            ],
          },
        ],
      },
      {
        title: "用哪家",
        caption:
          "保存服务、密钥或推理强度会重新打开当前会话，权限回到只读。每个服务使用自己的密钥。",
        blocks: [
          {
            kind: "choice",
            choice: {
              ...blocked,
              id: NATIVE_PRESET,
              options: PRESETS.map(presetLabel),
              selected: PRESETS.indexOf(preset),
            },
          },
        ],
      },
      ...(preset === "flash"
        ? []
        : [
            {
              title: "Kimi 推理强度",
              caption: "high 还没通过复杂任务验收，不能当成更可靠的选择。",
              blocks: [
                {
                  kind: "choice" as const,
                  choice: {
                    ...blocked,
                    id: NATIVE_KIMI_EFFORT,
                    options: ["low（默认）", "high（实验）"],
                    selected: state.settings.kimiReasoningEffort === "high" ? 1 : 0,
                  },
                },
              ],
            },
          ]),
      {
        title: "每一轮",
        caption: "调整请求上限、时限与长任务选项。",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "model.budget",
                text: `最多 ${state.settings.maxRequests} 次请求 · ${state.settings.timeoutMs / 1000} 秒`,
                sub: `长任务：${longTaskLabel(state)}`,
                controls: [{ id: "native.settings", label: "调整", ...blocked }],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function projectChatPages(
  state: DesktopState,
  appearance: ChatAppearance = DEFAULT_APPEARANCE,
  pending = false,
): {
  readonly settings: readonly SettingsPage[];
  readonly plugins: readonly PluginPage[];
} {
  const control = ([id, label]: [string, string]): Control => {
    const reason = nativeControlReason(state, id, pending);
    return { id, label, ...(reason ? { disabledReason: reason } : {}) };
  };
  const controls = (...items: [string, string][]): PageBlock => ({
    kind: "controls",
    controls: items.map(control),
  });
  const line = (id: string, text: string, sub: string, ...items: [string, string][]) => ({
    id,
    text,
    sub,
    controls: items.map(control),
  });
  const active = Boolean(state.activeSessionId && !state.historyOnly);
  const permission = state.historyOnly
    ? "当前只能查看历史，不能继续任务。"
    : state.activeSessionId
      ? permissionLabel(state.permissions, state.reportTarget, state.webAccess)
      : "选择工作目录后，以只读权限开始。";
  const settings: SettingsPage[] = [
    generalSettingsPage(appearance),
    shortcutsPage("设置", { editLast: false }),
    modelsPage(state, nativeControlReason(state, "native.settings", pending)),
    personalPage,
    memoryPage,
    {
      id: "permissions",
      name: "权限",
      icon: "shield",
      section: "数据安全",
      summary: permission,
      sub: "AI 能碰哪个文件夹，哪些事一定先问你。",
      groups: [
        {
          title: "工作目录",
          caption: "权限只管当前会话；重开会话会回到只读。",
          blocks: [
            {
              kind: "lines",
              lines: [
                {
                  ...line(
                    "permissions.folder",
                    state.workspaceRoot ?? "当前没有打开工作目录",
                    permission,
                    ["native.permissions", "工作目录权限"],
                    ["native.web", "网页访问"],
                  ),
                  ...(state.workspaceRoot ? { mono: true, icon: "folder" as const } : {}),
                },
              ],
            },
          ],
        },
        {
          title: "一直会先问你",
          caption: GUARANTEE,
          blocks: [
            {
              kind: "locks",
              lines: [
                "审批只针对显示的具体操作；停止不会撤销已经完成的修改。",
                "「本会话始终允许」只在当前会话内对同一工具（命令须完全相同）不再询问，重开会话即失效。",
                "计划模式下修改、命令和外部调用一律拒绝，不弹出审批；更改权限不会关闭计划模式。",
              ],
            },
          ],
        },
      ],
    },
    {
      id: "data",
      name: "数据",
      icon: "db",
      section: "数据安全",
      summary: "会话、材料和成果都在这台电脑上",
      sub: "你和 AI 说过的、做过的，都在哪，怎么留一份。",
      groups: [
        {
          title: "放在哪",
          blocks: [
            {
              kind: "lines",
              lines: [
                line(
                  "data.where",
                  "这台电脑上的 ~/.moyyi",
                  "会话记录和模型设置存在本机。项目文件仍在你选择的工作目录里。",
                ),
              ],
            },
          ],
        },
        {
          title: "当前会话",
          caption: state.activeSessionId
            ? `已选择 ${state.materials.length} 份材料；当前成果页有 ${state.artifacts.items.length} 项${state.artifacts.hasMore ? "，还有更多" : ""}。`
            : "先打开或新建一个会话，再查看材料与成果。",
          blocks: [
            {
              kind: "lines",
              lines: [
                line("data.history", "完整历史", "这个会话的每一步", ["native.history", "打开"]),
                line("data.materials", "材料库", "选给 AI 读的文档", ["native.materials", "打开"]),
                line("data.results", "报告与成果", "写出的报告、来源和操作记录", [
                  "native.artifacts",
                  "打开",
                ]),
              ],
            },
          ],
        },
        {
          title: "管理与备份",
          blocks: [
            {
              kind: "lines",
              lines: [
                line("data.sessions", "会话和回收站", "全部会话，删掉的先进回收站", [
                  "native.sessions",
                  "管理",
                ]),
                line("data.backup", "备份与回退", "备份保留会话与数据型设置，不导出钥匙串密钥", [
                  "native.maintenance",
                  "打开",
                ]),
              ],
            },
          ],
        },
      ],
    },
    helpPage,
    aboutPage,
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
