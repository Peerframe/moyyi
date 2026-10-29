import { parseSettings, validateApiKey } from "../../host/settings-schema.ts";
import { type ExactKeys, invalid } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
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
