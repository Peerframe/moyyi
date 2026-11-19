// 快捷键 (board S24). These are what App.tsx and the composer actually handle, so the mock and the
// desktop show the same page; change it together with the key handling.
import type { SettingsPage } from "../port.ts";

export function shortcutsPage(section: string, { editLast = true } = {}): SettingsPage {
  return {
    id: "shortcuts",
    name: "快捷键",
    icon: "keyboard",
    section,
    summary: "⌘K 跳到任意聊天 · ⌘, 打开设置",
    sub: "不碰鼠标也能做的事。",
    groups: [
      {
        title: "找",
        blocks: [
          {
            kind: "shortcuts",
            shortcuts: [
              { keys: ["⌘", "K"], what: "跳到任意聊天" },
              { keys: ["⌘", "F"], what: "在这个对话里找" },
              { keys: ["⌥", "↑"], what: "上一个聊天" },
              { keys: ["⌥", "↓"], what: "下一个聊天" },
            ],
          },
        ],
      },
      {
        title: "写和发",
        blocks: [
          {
            kind: "shortcuts",
            shortcuts: [
              { keys: ["⌘", "↩"], what: "发出去" },
              { keys: ["↩"], what: "换行，不会发出去" },
              ...(editLast ? [{ keys: ["↑"], what: "改刚发的那句（输入框空着时）" }] : []),
            ],
          },
        ],
      },
      {
        title: "窗口",
        blocks: [
          {
            kind: "shortcuts",
            shortcuts: [
              { keys: ["⌘", ","], what: "打开设置" },
              { keys: ["Esc"], what: "关掉菜单和面板" },
            ],
          },
        ],
      },
    ],
  };
}
