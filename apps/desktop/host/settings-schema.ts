import type { DesktopSettings } from "../shared.ts";

export function parseSettings(value: unknown): DesktopSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid model settings");
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = ["preset", "maxRequests", "timeoutMs"];
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => {
      const field = fields[k];
      return !field || !("value" in field);
    })
  )
    throw Error("Invalid model settings");
  const v = value as Record<string, unknown>;
  if (
    !["flash", "kimi-cn", "kimi-global"].includes(String(v.preset)) ||
    typeof v.preset !== "string" ||
    !Number.isSafeInteger(v.maxRequests) ||
    Number(v.maxRequests) < 1 ||
    Number(v.maxRequests) > 8 ||
    !Number.isSafeInteger(v.timeoutMs) ||
    Number(v.timeoutMs) < 30_000 ||
    Number(v.timeoutMs) > 300_000
  )
    throw Error("Invalid model settings");
  return {
    preset: v.preset as DesktopSettings["preset"],
    maxRequests: Number(v.maxRequests),
    timeoutMs: Number(v.timeoutMs),
  };
}

export function validateApiKey(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(value))
    throw Error("Invalid credential input");
  return value;
}
