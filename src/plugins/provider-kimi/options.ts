export const KIMI_API_PROFILE = "kimi-chat-text-v1-2026-10-27-reasoning-low";

export type KimiReasoningEffort = "low" | "high" | "max";

export interface KimiOptions {
  readonly reasoningEffort?: KimiReasoningEffort;
}

/** This profile always uses thinking; configuration never substitutes a reasoning summary. */
export function resolveKimiReasoningEffort(value: unknown): KimiReasoningEffort {
  if (value === undefined) return "low";
  if (value === "low" || value === "high" || value === "max") return value;
  throw Error("Kimi reasoning effort must be low, high or max");
}

export function kimiApiProfile(effort: KimiReasoningEffort = "low"): string {
  return `kimi-chat-text-v1-2026-10-27-reasoning-${resolveKimiReasoningEffort(effort)}`;
}
