import { type ExactKeys, identifier, invalid, page } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "approve":
      exact(
        input.scope === undefined
          ? ["type", "effectId", "digest", "decision"]
          : ["type", "effectId", "digest", "decision", "scope"],
      );
      if (
        !identifier(input.effectId) ||
        !identifier(input.digest) ||
        (input.decision !== "approve" && input.decision !== "deny") ||
        (input.scope !== undefined && (input.scope !== "session" || input.decision !== "approve"))
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
