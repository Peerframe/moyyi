import type { PageBlock, PluginPage, SettingsPage } from "../../chat/port.ts";
import { shortcutsPage } from "../../chat/ui/shortcuts.ts";
import type { DesktopSettings, DesktopState } from "../shared.ts";
import { permissionLabel } from "./effects-state.ts";
import { presetLabel } from "./view-state.ts";

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

/** The model card's key field and choices; the port maps them onto `configure`. */
export const NATIVE_MODEL = "native.model";
export const NATIVE_PRESET = "native.preset";
export const NATIVE_KIMI_EFFORT = "native.kimiEffort";
export const PRESETS: readonly DesktopSettings["preset"][] = ["flash", "kimi-cn", "kimi-global"];
export const KIMI_EFFORTS = ["low", "high"] as const;

const GUARANTEE = "这些是 moyyi 的保证，设置里关不掉。";
const line = (id: string, text: string, sub?: string, ...items: [string, string][]) => ({
  id,
  text,
  ...(sub ? { sub } : {}),
  ...(items.length ? { controls: items.map(([cid, label]) => ({ id: cid, label })) } : {}),
});

function modelsPage(state: DesktopState): SettingsPage {
  const { preset } = state.settings;
  const name = presetLabel(preset);
  const ready = state.connection.ready;
  return {
    id: "models",
    name: "模型",
    icon: "key",
    section: "功能",
    summary: `${name} · ${ready ? "已连上" : "还没连上"}`,
    sub: "AI 通过这个连接找模型。密钥只进 macOS 钥匙串，不会出现在聊天、记录和 AI 看到的内容里；保存不发模型请求。",
    groups: [
      {
        title: "连接",
        blocks: [
          {
            kind: "providers",
            providers: [
              {
                id: NATIVE_MODEL,
                letter: preset === "flash" ? "D" : "K",
                name,
                tag: "在用",
                connected: ready,
                status: ready
                  ? "密钥在系统钥匙串里 · 还没发请求验证"
                  : (state.connection.message ?? "还没连上：粘贴这家的密钥"),
                controls: [],
                keyField: {
                  placeholder: ready ? `换一把 ${name} 的密钥` : `粘贴 ${name} 的密钥`,
                  save: { id: `${NATIVE_MODEL}.save`, label: "存进钥匙串", tone: "primary" },
                },
              },
            ],
          },
        ],
      },
      {
        title: "用哪家",
        caption: "换了以后新的一轮开始用；每家用自己的密钥，服务地址固定。",
        blocks: [
          {
            kind: "choice",
            choice: {
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
        caption: "上限和长任务开关还在原来的设置窗口里改。",
        blocks: [
          {
            kind: "lines",
            lines: [
              line(
                "model.budget",
                `最多 ${state.settings.maxRequests} 次请求 · ${state.settings.timeoutMs / 1000} 秒`,
                `长任务：${longTaskLabel(state)}`,
                ["native.settings", "调整"],
              ),
            ],
          },
        ],
      },
    ],
  };
}

/** Only what this desktop really does; 个性化 and 记忆 wait for their capabilities. */
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
  const settings: SettingsPage[] = [
    {
      id: "general",
      name: "通用",
      icon: "sliders",
      section: "设置",
      summary: "颜色跟随系统",
      sub: "颜色和字号。",
      groups: [
        {
          title: "外观",
          blocks: [
            {
              kind: "lines",
              lines: [line("general.theme", "颜色：跟随系统", "跟着 macOS 的外观切换深色和浅色")],
            },
          ],
        },
      ],
    },
    shortcutsPage("设置"),
    modelsPage(state),
    {
      id: "permissions",
      name: "权限",
      icon: "shield",
      section: "数据安全",
      summary: permission,
      sub: "AI 能碰哪个文件夹，哪些事一定先问你。",
      groups: [
        {
          title: "当前会话",
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
          title: "本机数据",
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
    {
      id: "help",
      name: "获取帮助",
      icon: "help",
      section: "",
      summary: "怎么用 moyyi",
      sub: "怎么用 moyyi，数据会去哪。",
      groups: [
        {
          title: "开始使用",
          blocks: [
            {
              kind: "lines",
              lines: [
                {
                  id: "native.help",
                  text: "看文件夹、写报告、改文件、读网页",
                  sub: "每种做法怎么开始，读到的内容会发给谁",
                  link: true,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "about",
      name: "关于 moyyi",
      icon: "info",
      section: "",
      summary: "版本和用到的项目",
      sub: "版本和用到的开源项目。",
      groups: [
        { blocks: [{ kind: "brand", tagline: "moyyi · 墨一" }] },
        {
          title: "版本",
          blocks: [{ kind: "lines", lines: [line("about.version", "预览版", "本地桌面应用")] }],
        },
        {
          title: "用到的项目",
          blocks: [
            {
              kind: "lines",
              lines: [
                line(
                  "about.projects",
                  "界面里有一部分来自 OpenBot，做事的方法参考了 DeepSeek Harness；来源和许可记在项目文档里。",
                ),
              ],
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
