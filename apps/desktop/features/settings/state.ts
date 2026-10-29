import type { StateInitialization } from "../../native/contract.ts";
import { choice, integer, nullableInteger, object, string } from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "./contract.ts";
export function validateState(s: Record<string, unknown>): boolean {
  if (
    !object(s.connection, ["ready", "message"]) ||
    typeof s.connection.ready !== "boolean" ||
    (s.connection.message !== undefined && !string(s.connection.message, 4096))
  )
    return false;
  if (
    !object(s.settings, [
      "preset",
      "maxRequests",
      "timeoutMs",
      "kimiReasoningEffort",
      "evidenceAnswer",
    ]) ||
    !choice(s.settings.preset, ["flash", "kimi-cn", "kimi-global"]) ||
    !integer(s.settings.maxRequests) ||
    Number(s.settings.maxRequests) < 1 ||
    Number(s.settings.maxRequests) > 8 ||
    !integer(s.settings.timeoutMs) ||
    Number(s.settings.timeoutMs) < 30_000 ||
    Number(s.settings.timeoutMs) > 300_000 ||
    (s.settings.kimiReasoningEffort !== undefined &&
      !choice(s.settings.kimiReasoningEffort, ["low", "high"])) ||
    (s.settings.preset === "flash" && s.settings.kimiReasoningEffort === "high") ||
    (s.settings.evidenceAnswer !== undefined && typeof s.settings.evidenceAnswer !== "boolean") ||
    (s.settings.evidenceAnswer === true && Number(s.settings.maxRequests) < 2)
  )
    return false;
  if (
    s.model !== null &&
    !(
      object(s.model, ["provider", "model"]) &&
      string(s.model.provider, 128) &&
      string(s.model.model, 128)
    )
  )
    return false;
  if (
    !object(s.budgets, ["maxRequests", "timeoutMs", "maxOutputTokens"]) ||
    !nullableInteger(s.budgets.maxRequests) ||
    !nullableInteger(s.budgets.timeoutMs) ||
    !nullableInteger(s.budgets.maxOutputTokens)
  )
    return false;
  return true;
}
export function initialState({ options, display }: StateInitialization): FeatureState {
  return {
    connection: display.connection ?? { ready: true },
    settings: display.settings ?? DEFAULT_DESKTOP_SETTINGS,
    model: options.model ? { ...options.model } : null,
    budgets: {
      maxRequests: options.limits?.maxModelRequests ?? null,
      timeoutMs: options.limits?.timeoutMs ?? null,
      maxOutputTokens: display.maxOutputTokens ?? null,
    },
  };
}
