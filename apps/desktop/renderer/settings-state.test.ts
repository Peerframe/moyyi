import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "../shared.ts";
import {
  newSettingsDraft,
  saveSettingsDraft,
  selectKimiReasoningEffort,
  selectSettingsPreset,
  validateSettingsDraft,
} from "./settings-state.ts";
import { createActionGate } from "./view-state.ts";

describe("desktop settings credential lifetime", () => {
  it("keeps evidence review explicit and within the selected request limit", () => {
    const reviewed = newSettingsDraft({
      preset: "kimi-cn",
      maxRequests: 8,
      timeoutMs: 300_000,
      answerReview: true,
    });
    expect(validateSettingsDraft(reviewed)).toBeNull();
    expect(
      validateSettingsDraft({ ...reviewed, settings: { ...reviewed.settings, maxRequests: 3 } }),
    ).toContain("至少 4");
    expect(selectSettingsPreset(reviewed, "kimi-global").settings.answerReview).toBe(true);
    expect(selectSettingsPreset(reviewed, "flash").settings.answerReview).toBeUndefined();
    expect(DEFAULT_DESKTOP_SETTINGS.answerReview).toBeUndefined();
  });
  it("uses low for old settings and clears high when returning to Flash", async () => {
    const base = newSettingsDraft(DEFAULT_DESKTOP_SETTINGS);
    const kimi = selectSettingsPreset(base, "kimi-cn");
    expect(kimi.settings.kimiReasoningEffort).toBeUndefined();
    const high = selectKimiReasoningEffort({ ...kimi, apiKey: "synthetic-input" }, "high");
    expect(high.settings.kimiReasoningEffort).toBe("high");
    expect(high.apiKey).toBe("synthetic-input");
    expect(selectSettingsPreset(high, "kimi-global").settings.kimiReasoningEffort).toBe("high");
    expect(selectSettingsPreset(high, "flash")).toEqual(base);
    expect(selectKimiReasoningEffort(high, "low").settings).toEqual(kimi.settings);
    const configure = vi.fn(async () => undefined);
    await expect(
      saveSettingsDraft(
        { settings: { ...DEFAULT_DESKTOP_SETTINGS, kimiReasoningEffort: "high" }, apiKey: "" },
        () => {},
        configure,
      ),
    ).rejects.toThrow("仅 Kimi");
    await expect(
      saveSettingsDraft(
        {
          settings: { ...kimi.settings, kimiReasoningEffort: "max" } as unknown as DesktopSettings,
          apiKey: "",
        },
        () => {},
        configure,
      ),
    ).rejects.toThrow("仅 Kimi");
    expect(configure).not.toHaveBeenCalled();
    expect(DEFAULT_DESKTOP_SETTINGS).toEqual({
      preset: "flash",
      maxRequests: 3,
      timeoutMs: 120_000,
    });
  });

  it("clears a credential on preset change and dialog reset without mutating saved settings", () => {
    const settings = { ...DEFAULT_DESKTOP_SETTINGS };
    const draft = { settings, apiKey: "private-input" };
    expect(selectSettingsPreset(draft, "kimi-cn")).toEqual({
      settings: { ...settings, preset: "kimi-cn" },
      apiKey: "",
    });
    expect(newSettingsDraft(settings).apiKey).toBe("");
    expect(settings.preset).toBe("flash");
  });

  it("clears the input before a bridge failure and sends no key when preserving the existing one", async () => {
    let secret = "private-input";
    const configure = vi.fn(async (options: { apiKey?: string }) => {
      expect(secret).toBe("");
      expect(options.apiKey).toBe("private-input");
      throw Error("authorization cancelled");
    });
    await expect(
      saveSettingsDraft(
        { settings: DEFAULT_DESKTOP_SETTINGS, apiKey: secret },
        () => {
          secret = "";
        },
        configure,
      ),
    ).rejects.toThrow("authorization cancelled");
    const preserve = vi.fn(async () => ({ saved: true }));
    await expect(
      saveSettingsDraft(newSettingsDraft(DEFAULT_DESKTOP_SETTINGS), () => {}, preserve),
    ).resolves.toEqual({ saved: true });
    expect(preserve).toHaveBeenCalledWith({ settings: DEFAULT_DESKTOP_SETTINGS });
  });

  it("rejects invalid limits or credentials without sending them and still clears the input", async () => {
    const configure = vi.fn();
    const clear = vi.fn();
    await expect(
      saveSettingsDraft(
        { settings: { ...DEFAULT_DESKTOP_SETTINGS, maxRequests: 9 }, apiKey: "private-input" },
        clear,
        configure,
      ),
    ).rejects.toThrow("1 到 8");
    expect(clear).toHaveBeenCalledOnce();
    expect(configure).not.toHaveBeenCalled();
    for (const timeoutMs of [29_999, 300_001, Number.NaN])
      expect(
        validateSettingsDraft({ settings: { ...DEFAULT_DESKTOP_SETTINGS, timeoutMs }, apiKey: "" }),
      ).toContain("30 到 300");
    const message = validateSettingsDraft({
      settings: DEFAULT_DESKTOP_SETTINGS,
      apiKey: "private\ninput",
    });
    expect(message).not.toContain("private");
    expect(message).toContain("换行");
  });

  it("keeps repeated save events locked until rejection, then permits a retry", async () => {
    const gate = createActionGate();
    let reject!: (cause: Error) => void;
    const configure = vi.fn(
      () =>
        new Promise<never>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const save = async () => {
      if (!gate.begin()) return "busy";
      try {
        await saveSettingsDraft(newSettingsDraft(DEFAULT_DESKTOP_SETTINGS), () => {}, configure);
      } finally {
        gate.end();
      }
      return "saved";
    };
    const first = save();
    await expect(save()).resolves.toBe("busy");
    expect(configure).toHaveBeenCalledOnce();
    reject(Error("cancelled"));
    await expect(first).rejects.toThrow("cancelled");
    expect(gate.begin()).toBe(true);
  });
});
