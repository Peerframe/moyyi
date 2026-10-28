import type { DesktopSettings } from "../shared.ts";

export function parseSettings(value: unknown): DesktopSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid model settings");
  const fields = Object.getOwnPropertyDescriptors(value);
  const required = ["preset", "maxRequests", "timeoutMs"];
  const keys = [...required, "kimiReasoningEffort", "evidenceAnswer"];
  if (
    Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key)) ||
    Object.values(fields).some((field) => !("value" in field)) ||
    required.some((k) => {
      const field = fields[k];
      return !field || !("value" in field);
    })
  )
    throw Error("Invalid model settings");
  const v = value as Record<string, unknown>;
  const effort = fields.kimiReasoningEffort?.value;
  if (
    !["flash", "kimi-cn", "kimi-global"].includes(String(v.preset)) ||
    typeof v.preset !== "string" ||
    !Number.isSafeInteger(v.maxRequests) ||
    Number(v.maxRequests) < 1 ||
    Number(v.maxRequests) > 8 ||
    !Number.isSafeInteger(v.timeoutMs) ||
    Number(v.timeoutMs) < 30_000 ||
    Number(v.timeoutMs) > 300_000 ||
    (fields.kimiReasoningEffort !== undefined && effort !== "low" && effort !== "high") ||
    (v.preset === "flash" && effort === "high") ||
    (fields.evidenceAnswer !== undefined && typeof v.evidenceAnswer !== "boolean") ||
    (v.evidenceAnswer === true && Number(v.maxRequests) < 2)
  )
    throw Error("Invalid model settings");
  return {
    preset: v.preset as DesktopSettings["preset"],
    maxRequests: Number(v.maxRequests),
    timeoutMs: Number(v.timeoutMs),
    // Keep low settings readable by the previous desktop release without a migration.
    ...(effort === "high" ? { kimiReasoningEffort: "high" as const } : {}),
    ...(v.evidenceAnswer === true ? { evidenceAnswer: true } : {}),
  };
}

export function validateApiKey(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(value))
    throw Error("Invalid credential input");
  return value;
}
