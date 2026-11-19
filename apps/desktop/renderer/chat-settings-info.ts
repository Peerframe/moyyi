import type { SettingsPage } from "../../chat/port.ts";

// These constants come from the packaging inputs, never from a model or a remote document.
declare const __MOYYI_VERSION__: string;
declare const __MOYYI_NOTICES__: string;

export const personalPage: SettingsPage = {
  id: "me",
  name: "个性化",
  icon: "me",
  section: "功能",
  summary: "个人指令暂不可用 · 支持项目指令",
  sub: "个人指令适用于每个对话，项目指令只适用于选定的工作目录。",
  groups: [
    {
      title: "个人指令",
      blocks: [
        {
          kind: "text",
          field: {
            id: "me.instructions",
            label: "个人指令",
            value: "",
            max: 4000,
            save: {
              id: "me.instructions.save",
              label: "保存",
              tone: "primary",
              disabledReason: "此版本暂不支持保存跨对话的个人指令。",
            },
          },
        },
      ],
    },
    {
      title: "项目指令",
      blocks: [
        {
          kind: "lines",
          lines: [
            {
              id: "me.project",
              text: "在工作目录中使用 AGENTS.md",
              detail:
                "在工作目录根目录的 AGENTS.md 写下项目约定。下一次模型请求会按当前读取权限载入文件。会话权限仍由你控制。",
            },
          ],
        },
      ],
    },
  ],
};

export const memoryPage: SettingsPage = {
  id: "memory",
  name: "记忆",
  icon: "memory",
  section: "功能",
  summary: "自动记忆暂不可用",
  sub: "管理从对话中记下的偏好和习惯。",
  groups: [
    {
      blocks: [
        {
          kind: "switches",
          switches: [
            {
              id: "memory.auto",
              label: "自动记忆",
              on: false,
              disabledReason: "此版本尚未接入自动记忆。",
            },
          ],
        },
      ],
    },
    {
      title: "记下的",
      blocks: [{ kind: "note", text: "这里还没有自动记忆。已有对话仍可在「全部」中查看。" }],
    },
  ],
};

export const helpPage: SettingsPage = {
  id: "help",
  name: "获取帮助",
  icon: "help",
  section: "",
  summary: "开始使用与常见问题",
  sub: "怎么用 moyyi，遇到问题怎么处理。",
  groups: [
    {
      title: "开始使用",
      blocks: [
        {
          kind: "lines",
          lines: [
            {
              id: "help.folder",
              text: "让 AI 看懂一个文件夹",
              sub: "选择工作目录，让它读相关文件",
              detail:
                "回到「全部」，新建会话并选择工作目录，然后说明你想了解什么。选目录本身不会发送文件。任务使用文件工具读取的内容会随请求发给模型服务。",
            },
            {
              id: "help.report",
              text: "根据文档写一份报告",
              sub: "选材料、定报告位置、核对写入预览",
              detail:
                "在会话的「材料」里选择文档和报告目标，发出任务。审批卡会显示本次写入，完成后可在成果里核对文件。",
            },
            {
              id: "help.change",
              text: "让 AI 改文件、跑检查",
              sub: "先给当前会话权限，再核对操作",
              detail:
                "在会话的「权限」里开启需要的文件修改或命令检查权限。发送任务后，核对审批卡上的路径、改动或命令，再决定是否批准。",
            },
            {
              id: "help.web",
              text: "读网页、核对来源",
              sub: "授权确切的网站，查看读取记录",
              detail:
                "在「设置 → 权限 → 网页访问」里添加 HTTPS 来源。把完整网址发给 AI，核对每次访问的审批卡，读取结果会出现在网页来源中。",
            },
          ],
        },
      ],
    },
    {
      title: "常见问题",
      blocks: [
        {
          kind: "lines",
          lines: [
            {
              id: "help.stopped",
              text: "为什么做到一半停了？",
              detail:
                "先看会话结尾的运行状态。达到请求上限或时限后本轮会停止。需要继续时，可以在「设置 → 模型 → 每一轮」调整上限，再发送下一轮任务。",
            },
            {
              id: "help.undo",
              text: "改错了怎么撤回？",
              detail:
                "打开会话的「操作记录」，核对改动和当前文件，点「准备撤销」。检查草稿后发送，再审批撤销操作。已有多次改动时要从最近一次开始。",
            },
            {
              id: "help.keys",
              text: "密钥放在哪，什么时候会用？",
              detail:
                "在「设置 → 模型」保存的密钥由 macOS 钥匙串保管。保存时不会调用模型。发送任务后，所选服务会使用密钥进行身份验证。",
            },
          ],
        },
      ],
    },
    {
      title: "使用指南",
      blocks: [
        {
          kind: "lines",
          lines: [
            {
              id: "native.help",
              text: "查看完整使用指南",
              sub: "会话权限、材料和备份的详细步骤",
              link: true,
            },
          ],
        },
      ],
    },
  ],
};

export const aboutPage: SettingsPage = {
  id: "about",
  name: "关于 moyyi",
  icon: "info",
  section: "",
  summary: "版本和开源许可",
  sub: "版本和用到的开源项目。",
  groups: [
    { blocks: [{ kind: "brand", tagline: "moyyi · 墨一" }] },
    {
      title: "版本",
      blocks: [
        {
          kind: "lines",
          lines: [
            {
              id: "about.version",
              text:
                typeof __MOYYI_VERSION__ === "string"
                  ? `本地预览版 ${__MOYYI_VERSION__}`
                  : "本地预览版",
              sub: "macOS 桌面应用",
            },
          ],
        },
      ],
    },
    {
      title: "用到的项目",
      blocks: [
        {
          kind: "lines",
          lines: [
            {
              id: "about.licenses",
              text: "开源许可与来源",
              sub: "界面的部分组件来自 OpenBot，模型工具参考了 DeepSeek Harness。",
              detail:
                typeof __MOYYI_NOTICES__ === "string"
                  ? __MOYYI_NOTICES__
                  : "发行包内的 Resources/licenses 目录附有项目声明与许可。",
            },
          ],
        },
      ],
    },
  ],
};
