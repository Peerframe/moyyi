import { type ExactKeys, identifier, invalid, page } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "approve":
      exact(["type", "effectId", "digest", "decision"]);
      if (
        !identifier(input.effectId) ||
        !identifier(input.digest) ||
        (input.decision !== "approve" && input.decision !== "deny")
      )
        throw invalid();
      break;
    case "effects":
      exact(["type", "sessionId", "offset"]);
      if (!identifier(input.sessionId) || !page(input.offset)) throw invalid();
      break;
    case "effect.inspect":
      exact(["type", "sessionId", "effectId"]);
      if (!identifier(input.sessionId) || !identifier(input.effectId)) throw invalid();
      break;
    default:
      throw invalid();
  }
  return { ...input } as FeatureCommand;
}
