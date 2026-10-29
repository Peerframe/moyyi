import { type ExactKeys, identifier, invalid } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "permissions":
      exact(["type", "sessionId", "writes", "checks"]);
      if (
        !identifier(input.sessionId) ||
        typeof input.writes !== "boolean" ||
        typeof input.checks !== "boolean"
      )
        throw invalid();
      break;
    default:
      throw invalid();
  }
  return { ...input } as FeatureCommand;
}
