import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseAppearance,
  DEFAULT_APPEARANCE,
  generalSettingsPage,
  readAppearance,
  writeAppearance,
} from "./chat-appearance.ts";

afterEach(() => vi.unstubAllGlobals());

describe("desktop reading preferences", () => {
  it("restores saved appearance, validates each field, and falls back when the profile cannot be read", () => {
    const data = new Map<string, string>();
    const getItem = vi.fn((key: string) => data.get(key) ?? null);
    const setItem = (key: string, value: string) => data.set(key, value);
    vi.stubGlobal("window", { localStorage: { getItem, setItem } });
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
    writeAppearance({ theme: "dark", size: 17 });
    expect(readAppearance()).toEqual({ theme: "dark", size: 17 });
    getItem.mockReturnValueOnce('{"theme":"unknown","size":13}');
    expect(readAppearance()).toEqual({ theme: "system", size: 13 });
    getItem.mockReturnValueOnce("broken");
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
    vi.stubGlobal("window", {});
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(() => writeAppearance({ theme: "light", size: 15 })).toThrow("外观未保存");
  });

  it("maps the canvas choices to the displayed selections without affecting the other preference", () => {
    const current = { theme: "light", size: 17 } as const;
    expect(chooseAppearance(current, "general.theme", 2)).toEqual({ theme: "system", size: 17 });
    expect(chooseAppearance(current, "general.size", 0)).toEqual({ theme: "light", size: 13 });
    expect(() => chooseAppearance(current, "general.size", 3)).toThrow("字号");
    expect(() => chooseAppearance(current, "general.theme", -1)).toThrow("颜色");
    expect(chooseAppearance(current, "native.preset", 0)).toBeUndefined();
    const page = generalSettingsPage(current);
    expect(page.summary).toBe("浅色 · 字号 17");
    expect(page.groups[0]?.blocks[0]).toMatchObject({
      kind: "choices",
      choices: [
        { id: "general.theme", options: ["深色", "浅色", "跟随系统"], selected: 1 },
        { id: "general.size", options: ["13", "15", "17"], selected: 2 },
      ],
    });
  });
});
