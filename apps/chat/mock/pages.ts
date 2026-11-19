// 设置, 自动化 and 插件 as the mock backend holds them (boards S23–S32, S34, S35). Wording is the canvas
// wording; the runtime will build the same pages from its own settings, schedules and plugins.
import type {
  AutomationPage,
  Choice,
  Control,
  PageGroup,
  PluginPage,
  SettingsPage,
} from "../port.ts";
import { shortcutsPage } from "../ui/shortcuts.ts";

const GUARANTEE = "这些是 moyyi 的保证，设置里关不掉。";

const control = (id: string, label: string, tone?: Control["tone"]): Control =>
  tone ? { id, label, tone } : { id, label };

const choice = (
  id: string,
  options: readonly string[],
  selected: number,
  label?: string,
  note?: string,
): Choice => ({
  id,
  options,
  selected,
  ...(label ? { label } : {}),
  ...(note ? { note } : {}),
});

const locks = (lines: readonly string[], caption?: string, title = "一直是这样"): PageGroup => ({
  title,
  ...(caption ? { caption } : {}),
  blocks: [{ kind: "locks", lines }],
});

const SETTINGS = "设置";
const FEATURES = "功能";
const SAFETY = "数据安全";

function general(): SettingsPage {
  return {
    id: "general",
    name: "通用",
    icon: "sliders",
    section: SETTINGS,
    summary: "深色 · 字号 15 · 只提醒决定",
    sub: "颜色、字号和通知。",
    groups: [
      {
        title: "外观",
        blocks: [
          {
            kind: "choices",
            choices: [
              choice("general.theme", ["深色", "浅色", "跟随系统"], 0, "颜色"),
              choice("general.size", ["13", "15", "17"], 1, "字号", "消息、列表和面板一起变"),
            ],
          },
        ],
      },
      {
        title: "通知",
        blocks: [
          {
            kind: "choices",
            choices: [
              choice(
                "notify.messages",
                ["全部", "只提醒决定", "静音"],
                1,
                "普通消息",
                "每个对话能在它的资料里单独改",
              ),
            ],
          },
          {
            kind: "lines",
            lines: [
              {
                id: "notify.quiet",
                text: "免打扰 23:00–8:00",
                sub: "这段时间普通消息不响",
                controls: [control("notify.quiet.change", "改时间")],
              },
            ],
          },
        ],
      },
      locks(["等你决定的事，静音和免打扰时也会叫你"], GUARANTEE),
    ],
  };
}

function models(): SettingsPage {
  return {
    id: "models",
    name: "模型",
    icon: "key",
    section: FEATURES,
    summary: "2 个连接 · 新对话用 Flash",
    sub: "AI 通过这些连接找模型。同一家可以连好几个，比如两把 DeepSeek 密钥；密钥只进系统钥匙串，不会出现在聊天、记录和 AI 看到的内容里。",
    groups: [
      {
        title: "连接",
        blocks: [
          {
            kind: "providers",
            providers: [
              {
                id: "deepseek-main",
                letter: "D",
                name: "DeepSeek · 主力",
                tag: "默认",
                status: "密钥在系统钥匙串里 · 6 个对话在用",
                connected: true,
                controls: [
                  control("deepseek-main.test", "测一下"),
                  control("deepseek-main.edit", "编辑"),
                  control("deepseek-main.remove", "删掉", "danger"),
                ],
              },
              {
                id: "deepseek-spare",
                letter: "D",
                name: "DeepSeek · 备用",
                status: "密钥在系统钥匙串里",
                connected: true,
                controls: [
                  control("deepseek-spare.test", "测一下"),
                  control("deepseek-spare.edit", "编辑"),
                  control("deepseek-spare.remove", "删掉", "danger"),
                ],
              },
              {
                id: "kimi",
                letter: "K",
                name: "Kimi",
                status: "没连上",
                connected: false,
                controls: [control("kimi.remove", "删掉", "danger")],
                keyField: {
                  placeholder: "粘贴 Kimi 的密钥",
                  save: control("kimi.save", "存进钥匙串", "primary"),
                },
              },
            ],
          },
          { kind: "add", control: control("models.add", "添加模型连接") },
        ],
      },
      {
        title: "新对话默认用",
        caption: "用默认连接。已经在跑的对话不变，对话里随时能换连接。",
        blocks: [
          {
            kind: "choice",
            choice: choice("models.default", ["DeepSeek Flash", "DeepSeek Pro", "每次问我"], 0),
          },
        ],
      },
      locks(
        ["对话停在原处，不会自己换连接", "你换一个连接，在同一个对话里接着做"],
        GUARANTEE,
        "额度用完的时候",
      ),
    ],
  };
}

function personal(): SettingsPage {
  return {
    id: "me",
    name: "个性化",
    icon: "me",
    section: FEATURES,
    summary: "每个对话都带上的个人指令",
    sub: "每个 AI 开工前都会读到这些。怎么称呼你、怎么回你、守哪些规矩，写在一起就行。",
    groups: [
      {
        title: "个人指令",
        caption: "每个对话都带上。只给某个 AI 的，在它资料里的「你教过它的」加。",
        blocks: [
          {
            kind: "text",
            field: {
              id: "me.instructions",
              label: "个人指令",
              value:
                "叫我小文。\n不确定就直说，别猜。\n改文件前说清改哪几处。\n金额写到元，日期写成 11月4日。",
              max: 4000,
              note: "只存在这台电脑上",
              save: control("me.instructions.save", "保存", "primary"),
            },
          },
        ],
      },
      locks(["原样放进每次发给模型的内容里，在「AI 看到什么」里查得到"], GUARANTEE),
    ],
  };
}

function memory(): SettingsPage {
  return {
    id: "memory",
    name: "记忆",
    icon: "memory",
    section: FEATURES,
    summary: "自动记忆开着 · 记下 2 条",
    sub: "AI 从对话里记下你的偏好和习惯，对话越多越懂你。记忆只在这台电脑上。",
    groups: [
      {
        blocks: [
          {
            kind: "switches",
            switches: [
              {
                id: "memory.auto",
                label: "自动记忆",
                note: "从对话里记下你的偏好和习惯，以后的对话直接用上。记的时候不打断你。",
                on: true,
              },
            ],
          },
        ],
      },
      {
        title: "记下的",
        caption:
          "每条都写着从哪个对话来。改了以后 AI 按新的用；删掉后不会再给 AI 看，以前的记录不变。",
        action: control("memory.import", "导入"),
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "memory.cite",
                text: "论文引用用 GB/T 7714",
                sub: "从「毕业论文」记下 · 10月30日",
                controls: [
                  control("memory.cite.edit", "改"),
                  control("memory.cite.delete", "删掉"),
                ],
              },
              {
                id: "memory.rent",
                text: "房租每月 15 号交",
                sub: "从「租房」记下 · 10月28日",
                controls: [
                  control("memory.rent.edit", "改"),
                  control("memory.rent.delete", "删掉"),
                ],
              },
            ],
          },
        ],
      },
      locks(["记忆原样放进每次发给模型的内容里，在「AI 看到什么」里查得到"], GUARANTEE),
    ],
  };
}

function permissions(): SettingsPage {
  return {
    id: "permissions",
    name: "权限",
    icon: "shield",
    section: SAFETY,
    summary: "给过 2 个文件夹 · 改动先问你",
    sub: "AI 能碰哪些文件夹，哪些事一定先问你。",
    groups: [
      {
        title: "给过的文件夹",
        caption: "文件夹在聊天里给：回形针 → 整个文件夹。收回会在那个群里留一条消息。",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "folder.lunwen",
                text: "~/论文",
                mono: true,
                icon: "folder",
                sub: "给了「毕业论文」 · 10月30日",
                tag: "可以改",
                controls: [control("folder.lunwen.revoke", "收回")],
              },
              {
                id: "folder.zufang",
                text: "~/租房",
                mono: true,
                icon: "folder",
                sub: "给了「租房」 · 10月28日",
                tag: "只看",
                controls: [control("folder.zufang.revoke", "收回")],
              },
            ],
          },
        ],
      },
      locks(
        [
          "改文件、跑命令之前，先给你看要做什么",
          "删文件、发东西出去，每次都问你",
          "动没给过的文件夹之前，先问你",
          "每一处改动都留一条消息，能撤回",
          "任何一件事你都能随时停下",
        ],
        GUARANTEE,
        "一直会先问你",
      ),
    ],
  };
}

function data(): SettingsPage {
  return {
    id: "data",
    name: "数据",
    icon: "db",
    section: SAFETY,
    summary: "全在这台电脑上 · 可以备份和导出",
    sub: "你和 AI 说过的、做过的，都在哪，怎么留一份。",
    groups: [
      {
        title: "放在哪",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "data.where",
                text: "全在这台电脑上",
                sub: "~/.moyyi · 2.1 GB · 没有云端副本",
                controls: [control("data.where.reveal", "在 Finder 里看")],
              },
              {
                id: "data.seen",
                text: "AI 看到过什么",
                sub: "每次发给模型的内容都原样记下了。在消息菜单里点「AI 看到什么」就能看。",
              },
            ],
          },
        ],
      },
      {
        title: "备份和恢复",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "data.backup",
                text: "创建备份",
                sub: "对话记录和设置存成一个文件夹；不含钥匙串里的密钥",
                controls: [control("data.backup.create", "创建备份", "primary")],
              },
              {
                id: "data.restore",
                text: "从备份恢复",
                sub: "先把现在的记录另存一份，再换成备份里的",
                controls: [control("data.restore.choose", "选择备份")],
              },
            ],
          },
        ],
      },
      {
        title: "导出",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "data.export",
                text: "全部对话、改动和出处，导出成一个文件夹",
                sub: "只导出一个对话：在它的资料里导出",
                controls: [control("data.export.all", "导出全部")],
              },
            ],
          },
        ],
      },
      locks(["你说过的话：收回了也留在记录里", "每一处改动和它的留底"], GUARANTEE, "不会被删的"),
    ],
  };
}

const topic = (id: string, text: string, sub?: string) => ({
  id,
  text,
  ...(sub ? { sub } : {}),
  link: true,
});

function help(): SettingsPage {
  return {
    id: "help",
    name: "获取帮助",
    icon: "help",
    section: "",
    summary: "怎么用、常见问题、反馈",
    sub: "怎么用 moyyi，遇到问题去哪找。",
    groups: [
      {
        title: "开始使用",
        blocks: [
          {
            kind: "lines",
            lines: [
              topic(
                "help.folder",
                "让 AI 看懂一个文件夹",
                "选工作目录，说想知道什么；它读了哪些文件都列给你",
              ),
              topic("help.report", "根据文档写一份报告", "选好材料和报告放在哪，看过预览再让它写"),
              topic("help.change", "让 AI 改文件、跑检查", "每次动手前先给你看，改错了能撤回"),
              topic("help.web", "读网页、核对来源", "给出确切网址；每次打开都先问你"),
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
              topic("help.stopped", "为什么做到一半停了？"),
              topic("help.undo", "改错了怎么撤回？"),
              topic("help.keys", "密钥放在哪，会不会发出去？"),
            ],
          },
        ],
      },
      {
        title: "还没解决",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "help.info",
                text: "复制版本和系统信息",
                sub: "只有版本号和系统版本，不含对话和文件",
                controls: [control("help.info.copy", "复制")],
              },
              {
                id: "help.feedback",
                text: "反馈问题",
                sub: "说说哪里不对，附上刚才复制的信息",
                controls: [control("help.feedback.open", "去反馈")],
              },
            ],
          },
        ],
      },
    ],
  };
}

function about(): SettingsPage {
  return {
    id: "about",
    name: "关于 moyyi",
    icon: "info",
    section: "",
    summary: "版本和开源许可",
    sub: "版本和用到的开源项目。",
    groups: [
      { blocks: [{ kind: "brand", tagline: "AI 是联系人，项目是群，你是每个群的群主。" }] },
      {
        title: "版本",
        blocks: [
          {
            kind: "lines",
            lines: [{ id: "about.version", text: "预览版", sub: "本机安装 · 数据在 ~/.moyyi" }],
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
                id: "about.projects",
                text: "界面里有一部分来自 OpenBot，做事的方法参考了 DeepSeek Harness。每一处来源和许可都写在开源许可里。",
                controls: [control("about.licenses", "开源许可")],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function settingsPages(): readonly SettingsPage[] {
  return [
    general(),
    shortcutsPage(SETTINGS),
    models(),
    personal(),
    memory(),
    permissions(),
    data(),
    help(),
    about(),
  ];
}

function plugin(
  page: Omit<PluginPage, "enabled" | "toggle" | "groups">,
  groups: readonly PageGroup[],
): PluginPage {
  return { ...page, enabled: true, toggle: control(`${page.id}.toggle`, "停用", "danger"), groups };
}

const capability = (id: string, text: string, sub: string) => ({ id, text, sub });

function automation(
  page: Omit<AutomationPage, "enabled" | "toggle" | "icon" | "groups">,
  enabled: boolean,
  groups: readonly PageGroup[],
): AutomationPage {
  return {
    ...page,
    icon: "timer",
    enabled,
    toggle: control(
      `automation.${page.id}.toggle`,
      enabled ? "暂停" : "继续",
      enabled ? undefined : "primary",
    ),
    groups: [
      ...groups,
      {
        blocks: [
          {
            kind: "controls",
            controls: [
              control(`automation.${page.id}.run`, "现在跑一次"),
              control(`automation.${page.id}.delete`, "删掉", "danger"),
            ],
          },
        ],
      },
      locks(
        ["到点照常先给计划卡；要你决定的那一步不会替你决定", "开工和结果都留在它的对话里"],
        GUARANTEE,
      ),
    ],
  };
}

/** 自动化 (S34): jobs that start on their own, each in the chat it belongs to. */
export function automationPages(): readonly AutomationPage[] {
  return [
    automation(
      {
        id: "brief",
        name: "早报",
        summary: "每天 8:00 · 在「moyyi」",
        sub: "每天 8:00 在「moyyi」里开工",
      },
      true,
      [
        {
          title: "做什么",
          caption: "你在 10月28日 说的：“每天早上告诉我要做什么”。",
          blocks: [
            { kind: "note", text: "看一遍各项目等你决定的事和今天到期的事，写成一条早报发给你。" },
          ],
        },
        {
          title: "什么时候",
          blocks: [
            {
              kind: "choice",
              choice: choice("automation.brief.when", ["每天", "工作日", "每周一"], 0),
            },
          ],
        },
        {
          title: "最近几次",
          blocks: [
            {
              kind: "lines",
              lines: [
                { id: "brief.run.today", text: "今天 8:00", sub: "发了早报 · 3 件事想问你" },
                { id: "brief.run.yesterday", text: "昨天 8:00", sub: "发了早报 · 1 件等你决定" },
              ],
            },
          ],
        },
      ],
    ),
    automation(
      {
        id: "format",
        name: "查论文格式",
        summary: "每周一 9:00 · 在「毕业论文」",
        sub: "每周一 9:00 在「毕业论文」里开工",
      },
      true,
      [
        {
          title: "做什么",
          blocks: [{ kind: "note", text: "按学校模板查一遍 5 章的格式，只列出问题，不改文件。" }],
        },
        {
          title: "什么时候",
          blocks: [
            {
              kind: "choice",
              choice: choice("automation.format.when", ["每天", "工作日", "每周一"], 2),
            },
          ],
        },
        {
          title: "最近几次",
          blocks: [
            {
              kind: "lines",
              lines: [
                { id: "format.run.last", text: "10月28日 9:00", sub: "找出 12 处 · 你让写作改了" },
              ],
            },
          ],
        },
      ],
    ),
    automation(
      {
        id: "excerpt",
        name: "读书会摘录",
        summary: "已暂停 · 每周二 20:00 · 在「读书会资料」",
        sub: "每周二 20:00 在「读书会资料」里开工",
      },
      false,
      [
        {
          title: "做什么",
          blocks: [{ kind: "note", text: "把这周读到的章节整理成摘录，每段对上原书页码。" }],
        },
        {
          title: "什么时候",
          blocks: [
            { kind: "choice", choice: choice("automation.excerpt.when", ["每周二", "每周五"], 0) },
          ],
        },
        {
          title: "最近几次",
          blocks: [
            {
              kind: "lines",
              lines: [
                { id: "excerpt.run.last", text: "周二 20:00", sub: "整理了 13 段 · 都对过页码" },
              ],
            },
          ],
        },
      ],
    ),
  ];
}

export function pluginPages(): readonly PluginPage[] {
  return [
    plugin(
      {
        id: "files",
        name: "文件",
        icon: "folder",
        summary: "看和改你给过的文件夹",
        sub: "内置插件 · 让 AI 看和改你给过的文件夹",
      },
      [
        {
          title: "它能做的",
          blocks: [
            {
              kind: "lines",
              lines: [
                capability("files.read", "看给过的文件夹里的文件", "Word、Markdown、表格和图片"),
                capability(
                  "files.write",
                  "在「可以改」的文件夹里改文件",
                  "每一处改动都留一条消息，能撤回",
                ),
              ],
            },
          ],
        },
        locks(["动没给过的文件夹之前，先问你", "删文件每次都问你"], GUARANTEE),
      ],
    ),
    plugin(
      {
        id: "shell",
        name: "命令行",
        icon: "term",
        summary: "在这台电脑上跑命令 · 跑前问你",
        sub: "内置插件 · 让 AI 在这台电脑上跑命令",
      },
      [
        {
          title: "它能做的",
          blocks: [
            {
              kind: "lines",
              lines: [
                capability("shell.run", "在给过的文件夹里跑命令", "编译、跑测试、转格式"),
                capability("shell.read", "读命令的输出，接着做下一步", "输出太长时只看开头和结尾"),
              ],
            },
          ],
        },
        {
          title: "谁在用",
          caption: "某个 AI 不该跑命令，在它的资料里关掉。",
          blocks: [
            {
              kind: "lines",
              lines: [
                {
                  id: "shell.users",
                  members: ["moyyi", "hecha", "xiezuo"],
                  text: "3 个 AI",
                  sub: "最近一次：在「毕业论文」里跑了 pandoc 转格式 · 今天 18:02",
                },
              ],
            },
          ],
        },
        {
          title: "设置",
          blocks: [
            {
              kind: "choices",
              choices: [
                choice(
                  "shell.timeout",
                  ["1 分钟", "5 分钟", "30 分钟"],
                  1,
                  "一条命令最多跑",
                  "到时间自动停下，在对话里留一条消息",
                ),
                choice("shell.network", ["不能", "每次问", "能"], 0, "命令能上网吗"),
              ],
            },
          ],
        },
        locks(
          [
            "跑之前先问你（在 设置 › 权限和确认 里选怎么问）",
            "任何一条命令你都能随时停下",
            "命令和输出原样记下来",
          ],
          GUARANTEE,
        ),
      ],
    ),
    plugin(
      {
        id: "web",
        name: "网页",
        icon: "globe",
        summary: "搜索和打开网页",
        sub: "内置插件 · 让 AI 搜索和打开网页",
      },
      [
        {
          title: "它能做的",
          blocks: [
            {
              kind: "lines",
              lines: [
                capability("web.search", "搜索网页", "结论会带上网址"),
                capability(
                  "web.open",
                  "打开一个网页读正文",
                  "打开前怎么问，在 设置 › 权限和确认 里选",
                ),
              ],
            },
          ],
        },
      ],
    ),
    plugin(
      {
        id: "documents",
        name: "文档",
        icon: "doc",
        summary: "读 PDF、Word 和表格",
        sub: "内置插件 · 让 AI 读 PDF、Word 和表格",
      },
      [
        {
          title: "它能做的",
          blocks: [
            {
              kind: "lines",
              lines: [capability("documents.read", "读 PDF、Word 和表格", "结论会标第几页")],
            },
          ],
        },
      ],
    ),
    plugin(
      {
        id: "skills",
        name: "技能",
        icon: "skill",
        summary: "照你写好的做法做事 · 开着 2 个",
        sub: "内置插件 · 照你写好的做法做事",
      },
      [
        {
          title: "技能库",
          caption:
            "一个技能是一个文件夹，里面一份 SKILL.md。只有开着的技能会放进 AI 看到的内容里。",
          blocks: [
            {
              kind: "lines",
              lines: [
                {
                  id: "skills.library",
                  text: "~/moyyi/技能",
                  mono: true,
                  sub: "3 个技能 · 开着 2 个",
                  controls: [control("skills.reveal", "在 Finder 里看")],
                },
              ],
            },
          ],
        },
        {
          title: "技能",
          blocks: [
            {
              kind: "lines",
              lines: [
                skill("skill.format", "论文格式", "按学校模板查标题、图表和引用", true),
                skill("skill.contract", "合同对照", "逐条比两份合同，标出不同", true),
                skill("skill.weekly", "周报", "把这周的改动写成一份周报", false),
              ],
            },
          ],
        },
        locks(
          [
            "技能只是做法，不能给 AI 多加权限",
            "每次找模型前都重新读一遍，改了马上生效",
            "读不到的技能会直说，不会假装用了",
          ],
          GUARANTEE,
        ),
      ],
    ),
  ];
}

export function skill(id: string, text: string, sub: string, on: boolean) {
  return {
    id,
    text,
    sub,
    tag: on ? "开着" : "关着",
    off: !on,
    controls: [control(`${id}.toggle`, on ? "关掉" : "打开")],
  };
}
