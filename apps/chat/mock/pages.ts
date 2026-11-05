// 设置 and 插件 as the mock backend holds them (boards S23–S32). Wording is the canvas wording; the
// runtime will build the same pages from its own settings, grants and plugin registry.
import type { Choice, Control, PageGroup, PluginPage, SettingsPage } from "../port.ts";

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

function models(): SettingsPage {
  return {
    id: "models",
    name: "模型和密钥",
    icon: "key",
    summary: "DeepSeek 已连上 · 新对话用 Flash",
    sub: "AI 用哪些模型，密钥放在哪",
    groups: [
      {
        title: "已连上",
        blocks: [
          {
            kind: "providers",
            providers: [
              {
                id: "deepseek",
                letter: "D",
                name: "DeepSeek",
                status: "已连上 · 密钥在系统钥匙串里 · 6 个对话在用",
                connected: true,
                controls: [
                  control("deepseek.test", "测一下"),
                  control("deepseek.rekey", "换密钥"),
                  control("deepseek.disconnect", "断开", "danger"),
                ],
              },
            ],
          },
        ],
      },
      {
        title: "还可以连",
        caption: "密钥只进系统钥匙串。它不会出现在聊天、记录和 AI 看到的内容里，也不会被同步。",
        blocks: [
          {
            kind: "providers",
            providers: [
              {
                id: "kimi",
                letter: "K",
                name: "Kimi",
                status: "没连上",
                connected: false,
                controls: [],
                keyField: {
                  placeholder: "粘贴 Kimi 的密钥",
                  save: control("kimi.save", "存进钥匙串", "primary"),
                },
              },
              {
                id: "anthropic",
                letter: "A",
                name: "Anthropic",
                status: "没连上",
                connected: false,
                controls: [control("anthropic.connect", "连上")],
              },
            ],
          },
        ],
      },
      {
        title: "新对话默认用",
        caption: "已经在跑的对话不变。某个 AI 或项目要换模型，去它的资料里换。",
        blocks: [
          {
            kind: "choice",
            choice: choice("models.default", ["DeepSeek Flash", "DeepSeek Pro", "每次问我"], 0),
          },
        ],
      },
    ],
  };
}

function aboutMe(): SettingsPage {
  return {
    id: "me",
    name: "关于我",
    icon: "me",
    summary: "每个 AI 都知道的称呼、语言和规矩",
    sub: "每个 AI 开工前都会读到这些",
    groups: [
      {
        title: "怎么回你",
        blocks: [
          {
            kind: "choices",
            choices: [
              choice("me.language", ["中文", "English", "跟着我"], 2, "用什么语言"),
              choice("me.order", ["先说结论", "先讲过程"], 0, "先说什么"),
            ],
          },
        ],
      },
      {
        title: "所有 AI 都要守的",
        caption: "只给某个 AI 的，在它资料里的「你教过它的」加。",
        blocks: [
          {
            kind: "chips",
            chips: ["不确定就直说", "改文件前说清改哪几处", "金额写到元", "日期写成 11月4日"],
            add: control("me.rules.add", "加一条"),
          },
        ],
      },
      {
        title: "记忆记下的你",
        caption: "每条都写着从哪个对话来。删掉后不会再给 AI 看；以前的记录不变。",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "memory.cite",
                text: "论文引用用 GB/T 7714",
                sub: "从「毕业论文」记下 · 10月30日",
                controls: [control("memory.cite.delete", "删掉")],
              },
              {
                id: "memory.rent",
                text: "房租每月 15 号交",
                sub: "从「租房」记下 · 10月28日",
                controls: [control("memory.rent.delete", "删掉")],
              },
            ],
          },
        ],
      },
      locks(["这些内容原样放进每次发给模型的内容里，在「AI 看到什么」里查得到"]),
    ],
  };
}

function permissions(): SettingsPage {
  return {
    id: "permissions",
    name: "权限和确认",
    icon: "shield",
    summary: "改文件、跑命令前先问你",
    sub: "AI 动手之前，什么时候要先问你",
    groups: [
      {
        title: "先问你的时候",
        caption:
          "计划卡里一起问：开始前把要改的、要跑的都列出来，你点一次开始。计划外的事还会再问。",
        blocks: [
          {
            kind: "choices",
            choices: [
              choice("ask.files", ["每次问", "计划卡里一起问"], 1, "改文件"),
              choice("ask.commands", ["每次问", "计划卡里一起问"], 0, "跑命令"),
              choice("ask.web", ["每次问", "不用问", "不许"], 0, "打开网页"),
            ],
          },
        ],
      },
      {
        title: "给过的文件夹",
        caption:
          "文件夹在聊天里给：回形针 → 整个文件夹。这里能看全部，也能收回；收回会在那个群里留一条消息。",
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
          "删文件、发东西出去，每次都问你",
          "动没给过的文件夹之前，先问你",
          "每一处改动都留一条消息，能撤回",
          "任何一件事你都能随时停下",
        ],
        GUARANTEE,
        "这几条一直开着",
      ),
    ],
  };
}

function background(): SettingsPage {
  const timed = (id: string, when: string, what: string, where: string) => ({
    id,
    text: `${when} · ${what}`,
    sub: `在「${where}」里做`,
    controls: [control(`${id}.pause`, "暂停")],
  });
  return {
    id: "background",
    name: "后台和定时",
    icon: "timer",
    summary: "同时做 3 件 · 2 件定时",
    sub: "你不看着的时候，AI 怎么做事",
    groups: [
      {
        title: "同时做几件事",
        caption: "多出来的排队，在文件夹栏的「在做」里看得到。",
        blocks: [{ kind: "choice", choice: choice("jobs.parallel", ["1 件", "3 件", "5 件"], 1) }],
      },
      {
        title: "做到要你决定的地方",
        caption: "选哪个都一样：要你决定的那一步，不会替你决定。",
        blocks: [
          {
            kind: "choice",
            choice: choice("jobs.atDecision", ["停下等你", "先做不用决定的部分"], 1),
          },
        ],
      },
      {
        title: "定时的事",
        caption: "在任意对话里说 /定时 加一件。到点在那个对话里开工，照常先给计划卡。",
        blocks: [
          {
            kind: "lines",
            lines: [
              timed("timer.brief", "每天 8:00", "早报：今天要做什么", "moyyi"),
              timed("timer.format", "每周一 9:00", "查一遍论文格式", "毕业论文"),
            ],
          },
        ],
      },
      {
        title: "关机或断网以后",
        blocks: [
          { kind: "choice", choice: choice("jobs.resume", ["回来自动接着做", "先问我"], 1) },
        ],
      },
      locks(["从记录里接着做，做完的改动不会再做一遍"], GUARANTEE),
    ],
  };
}

function budget(): SettingsPage {
  return {
    id: "budget",
    name: "预算",
    icon: "gauge",
    summary: "新项目默认每周 40 次",
    sub: "AI 每次找模型都算一次。新项目给多少，用完了怎么办",
    groups: [
      {
        title: "新项目默认每周",
        caption: "计划卡上会写这个数，你点开始之前都能改。",
        blocks: [
          { kind: "choice", choice: choice("budget.default", ["20 次", "40 次", "每次问我"], 1) },
        ],
      },
      {
        title: "这周用了多少",
        caption: "要给某个项目加，在它的资料里加，或者在群里说 /预算。",
        blocks: [
          {
            kind: "meters",
            meters: [
              {
                id: "lunwen",
                avatar: { text: "论", tone: "accent" },
                shape: "project",
                name: "毕业论文",
                used: 31,
                total: 40,
              },
              {
                id: "zufang",
                avatar: { text: "租", tone: "key" },
                shape: "project",
                name: "租房",
                used: 12,
                total: 40,
              },
              {
                id: "fanyi",
                avatar: { text: "译", tone: "quiet" },
                shape: "ai",
                name: "翻译",
                used: 40,
                total: 40,
                alert: "用完了 · 已暂停",
              },
            ],
          },
        ],
      },
      locks(
        ["停下来等你，不会自己追加", "停下时说清做到哪一步、留下了什么"],
        GUARANTEE,
        "用完的时候",
      ),
    ],
  };
}

function records(): SettingsPage {
  return {
    id: "records",
    name: "记录和数据",
    icon: "db",
    summary: "全在这台电脑上 · 可以导出",
    sub: "你和 AI 说过的、做过的，都在哪",
    groups: [
      {
        title: "放在哪",
        caption: "没有云端副本。记录、文件改动的留底和贴纸都只在这里。",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "records.where",
                text: "全在这台电脑上",
                sub: "~/Library/Application Support/moyyi · 2.1 GB",
                controls: [control("records.reveal", "在 Finder 里看")],
              },
            ],
          },
        ],
      },
      {
        title: "AI 看到过什么",
        blocks: [
          {
            kind: "note",
            text: "每次发给模型的内容都原样记下了。在一条消息的菜单里点“AI 看到什么”，能看到它当时收到的全部内容。",
          },
        ],
      },
      {
        title: "导出",
        caption: "只导出一个对话：在它的资料里导出。",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "records.export",
                text: "全部对话、改动和出处，导出成一个文件夹",
                controls: [control("records.export", "导出全部", "primary")],
              },
            ],
          },
        ],
      },
      locks(["你说过的话：收回了也留在记录里", "每一处改动和它的留底"], GUARANTEE, "不会被删的"),
    ],
  };
}

function general(): SettingsPage {
  return {
    id: "general",
    name: "通用",
    icon: "sliders",
    summary: "深色 · 字号 15 · 只提醒决定",
    sub: "颜色、字号、通知和快捷键",
    groups: [
      {
        title: "看起来",
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
      {
        title: "快捷键",
        blocks: [
          {
            kind: "shortcuts",
            shortcuts: [
              { keys: ["⌘", "K"], what: "跳到任意聊天" },
              { keys: ["⌘", ","], what: "打开设置" },
              { keys: ["⌘", "F"], what: "在这个对话里找" },
            ],
            more: control("shortcuts.all", "看全部快捷键"),
          },
        ],
      },
      locks(["等你决定的事，静音和免打扰时也会叫你"], GUARANTEE),
    ],
  };
}

function about(): SettingsPage {
  return {
    id: "about",
    name: "关于 moyyi",
    icon: "info",
    summary: "版本和更新",
    groups: [
      { blocks: [{ kind: "brand", tagline: "AI 是联系人，项目是群，你是每个群的群主。" }] },
      {
        title: "版本",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "about.version",
                text: "预览版",
                sub: "已是最新 · 上次检查 今天 8:00",
                controls: [control("about.update", "检查更新")],
              },
            ],
          },
        ],
      },
      {
        title: "用到的项目",
        blocks: [
          {
            kind: "note",
            text: "界面里有一部分来自 OpenBot，做事的方法参考了 DeepSeek Harness。每一处来源和许可都写在开源许可里。",
          },
          {
            kind: "controls",
            controls: [
              control("about.licenses", "开源许可"),
              control("about.feedback", "反馈问题"),
            ],
          },
        ],
      },
    ],
  };
}

export function settingsPages(): readonly SettingsPage[] {
  return [
    models(),
    aboutMe(),
    permissions(),
    background(),
    budget(),
    records(),
    general(),
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
