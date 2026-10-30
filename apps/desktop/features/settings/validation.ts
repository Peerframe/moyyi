import { parseSettings, validateApiKey } from "../../host/settings-schema.ts";
import { type ExactKeys, invalid } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "connection.change": {
      exact(["type", "change"]);
      const c = input.change;
      if (
        !c ||
        typeof c !== "object" ||
        Array.isArray(c) ||
        Object.values(Object.getOwnPropertyDescriptors(c)).some((f) => !("value" in f))
      )
        throw invalid();
      const v = c as Record<string, unknown>;
      const keys =
        v.action === "add"
          ? ["action", "name", "provider", ...(v.apiKey === undefined ? [] : ["apiKey"])]
          : v.action === "rename"
            ? ["action", "id", "name"]
            : ["action", "id"];
      if (Object.keys(v).sort().join() !== keys.sort().join()) throw invalid();
      if (!["add", "rename", "delete", "select", "search"].includes(String(v.action)))
        throw invalid();
      if (v.action !== "add" && (typeof v.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(v.id)))
        throw invalid();
      if (
        (v.action === "add" || v.action === "rename") &&
        (typeof v.name !== "string" ||
          !v.name.trim() ||
          v.name.length > 80 ||
          /[\x00-\x1f\x7f]/.test(v.name))
      )
        throw invalid();
      if (
        v.action === "add" &&
        !["deepseek", "kimi-cn", "kimi-global"].includes(String(v.provider))
      )
        throw invalid();
      if (v.apiKey !== undefined) validateApiKey(v.apiKey);
      return {
        type: "connection.change",
        change: v as unknown as import("./contract.ts").ConnectionChange,
      };
    }
    case "configure": {
      exact(input.apiKey === undefined ? ["type", "settings"] : ["type", "settings", "apiKey"]);
      try {
        const settings = parseSettings(input.settings);
        return input.apiKey === undefined
          ? { type: "configure", settings }
          : { type: "configure", settings, apiKey: validateApiKey(input.apiKey) };
      } catch {
        throw invalid();
      }
    }
    default:
      throw invalid();
  }
}
