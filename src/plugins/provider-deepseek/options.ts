export const DEEPSEEK_API_PROFILE = "deepseek-responses-text-v1-2026-10-25";

export type DeepSeekReasoningEffort = "none" | "low" | "high" | "max";

export interface DeepSeekOptions {
  readonly reasoningEffort?: DeepSeekReasoningEffort;
}

/** Validate host input without reflecting arbitrary configuration values in diagnostics. */
export function resolveDeepSeekReasoningEffort(value: unknown): DeepSeekReasoningEffort {
  if (value === undefined) return "high";
  if (value === "none" || value === "low" || value === "high" || value === "max") return value;
  throw Error("DeepSeek reasoning effort must be none, low, high or max");
}

/** Old records imply high; other efforts must never replay under that legacy profile. */
export function deepSeekApiProfile(effort: DeepSeekReasoningEffort = "high"): string {
  const selected = resolveDeepSeekReasoningEffort(effort);
  return selected === "high"
    ? DEEPSEEK_API_PROFILE
    : `${DEEPSEEK_API_PROFILE}-reasoning-${selected}`;
}
