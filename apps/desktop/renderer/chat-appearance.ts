import { useSyncExternalStore } from "react";
import type { SettingsPage, Theme } from "../../chat/port.ts";

const THEMES = ["dark", "light", "system"] as const;
const THEME_NAMES = ["深色", "浅色", "跟随系统"] as const;
const SIZES = [13, 15, 17] as const;
const STORAGE_KEY = "moyyi.chat.appearance";

export interface ChatAppearance {
  readonly theme: (typeof THEMES)[number];
  readonly size: (typeof SIZES)[number];
}

export const DEFAULT_APPEARANCE: ChatAppearance = { theme: "system", size: 15 };

export function readAppearance(): ChatAppearance {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_APPEARANCE;
    const raw: unknown = JSON.parse(stored);
    if (typeof raw !== "object" || raw === null) return DEFAULT_APPEARANCE;
    return {
      theme:
        THEMES.find((item) => "theme" in raw && item === raw.theme) ?? DEFAULT_APPEARANCE.theme,
      size: SIZES.find((item) => "size" in raw && item === raw.size) ?? DEFAULT_APPEARANCE.size,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearance(next: ChatAppearance): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme: next.theme, size: next.size }),
    );
  } catch {
    throw Error("外观未保存。请检查本机存储后重试。");
  }
}

export function chooseAppearance(
  current: ChatAppearance,
  id: string,
  option: number,
): ChatAppearance | undefined {
  if (id === "general.theme") {
    const theme = THEMES[option];
    if (!theme) throw Error("没有这个颜色选项。");
    return { ...current, theme };
  }
  if (id === "general.size") {
    const size = SIZES[option];
    if (!size) throw Error("没有这个字号选项。");
    return { ...current, size };
  }
  return undefined;
}

const darkScheme = "(prefers-color-scheme: dark)";

function subscribeScheme(update: () => void) {
  const media = matchMedia(darkScheme);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

export function useWindowTheme(theme: ChatAppearance["theme"]): Theme {
  const systemDark = useSyncExternalStore(
    subscribeScheme,
    () => matchMedia(darkScheme).matches,
    () => false,
  );
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function generalSettingsPage(appearance: ChatAppearance = DEFAULT_APPEARANCE): SettingsPage {
  const selectedTheme = THEMES.indexOf(appearance.theme);
  return {
    id: "general",
    name: "通用",
    icon: "sliders",
    section: "设置",
    summary: `${THEME_NAMES[selectedTheme]} · 字号 ${appearance.size}`,
    sub: "颜色、字号和通知。",
    groups: [
      {
        title: "外观",
        blocks: [
          {
            kind: "choices",
            choices: [
              { id: "general.theme", label: "颜色", options: THEME_NAMES, selected: selectedTheme },
              {
                id: "general.size",
                label: "字号",
                options: SIZES.map(String),
                selected: SIZES.indexOf(appearance.size),
                note: "消息、列表和面板一起变",
              },
            ],
          },
        ],
      },
      {
        title: "通知",
        blocks: [
          {
            kind: "lines",
            lines: [
              {
                id: "notify.decisions",
                text: "需要你决定时，在会话里提醒",
                sub: "当前版本没有系统通知。",
              },
            ],
          },
        ],
      },
    ],
  };
}
