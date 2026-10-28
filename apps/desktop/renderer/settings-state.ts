import type { DesktopSettings } from "../shared.ts";

export interface SettingsDraft {
  readonly settings: DesktopSettings;
  readonly apiKey: string;
}

export function newSettingsDraft(settings: DesktopSettings): SettingsDraft {
  return { settings: { ...settings }, apiKey: "" };
}

export function selectSettingsPreset(
  draft: SettingsDraft,
  preset: DesktopSettings["preset"],
): SettingsDraft {
  const { kimiReasoningEffort, evidenceAnswer, ...settings } = draft.settings;
  return {
    settings: {
      ...settings,
      preset,
      ...(preset !== "flash" && kimiReasoningEffort === "high" ? { kimiReasoningEffort } : {}),
      ...(preset !== "flash" && evidenceAnswer ? { evidenceAnswer } : {}),
    },
    apiKey: "",
  };
}

export function selectKimiReasoningEffort(
  draft: SettingsDraft,
  effort: "low" | "high",
): SettingsDraft {
  const { kimiReasoningEffort: _previous, ...settings } = draft.settings;
  return {
    ...draft,
    settings: {
      ...settings,
      ...(settings.preset !== "flash" && effort === "high" ? { kimiReasoningEffort: effort } : {}),
    },
  };
}

export function validateSettingsDraft(draft: SettingsDraft): string | null {
  const { maxRequests, timeoutMs, preset, kimiReasoningEffort } = draft.settings;
  if (
    (kimiReasoningEffort !== undefined && !["low", "high"].includes(kimiReasoningEffort)) ||
    (preset === "flash" && kimiReasoningEffort === "high")
  )
    return "仅 Kimi 可显式选择 high；Flash 固定使用 low。";
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 8)
    return "每轮请求上限应为 1 到 8 的整数。";
  if (
    (draft.settings.evidenceAnswer !== undefined &&
      typeof draft.settings.evidenceAnswer !== "boolean") ||
    (draft.settings.evidenceAnswer && maxRequests < 2)
  )
    return "独立证据成文需要至少 2 次请求的总上限。";
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 300_000)
    return "每轮时限应为 30 到 300 秒。";
  if (draft.apiKey && !/^[\x21-\x7e]{1,4096}$/.test(draft.apiKey))
    return "API Key 不能包含空格或换行，且不能超过 4096 个字符。";
  return null;
}

/** Clear the input before the bridge can reject; never include credentials in UI errors. */
export async function saveSettingsDraft<T>(
  draft: SettingsDraft,
  clearSecret: () => void,
  configure: (options: { settings: DesktopSettings; apiKey?: string }) => Promise<T>,
): Promise<T> {
  const error = validateSettingsDraft(draft);
  const options = {
    settings: { ...draft.settings },
    ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
  };
  clearSecret();
  if (error) throw Error(error);
  return configure(options);
}

export function presetLabel(preset: DesktopSettings["preset"]): string {
  return { flash: "DeepSeek Flash", "kimi-cn": "Kimi · 中国", "kimi-global": "Kimi · 全球" }[
    preset
  ];
}
