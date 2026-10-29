import { Buffer } from "node:buffer";
import { type ExactKeys, identifier, invalid } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "start":
      exact(["type", "sessionId", "text"]);
      if (
        !identifier(input.sessionId) ||
        typeof input.text !== "string" ||
        !input.text.trim() ||
        Buffer.byteLength(JSON.stringify([{ type: "text", text: input.text }])) > 65_536
      )
        throw invalid();
      break;
    case "cancel":
      exact(["type", "runId"]);
      if (!identifier(input.runId)) throw invalid();
      break;
    case "close":
      exact(["type"]);
      break;
    default:
      throw invalid();
  }
  return { ...input } as FeatureCommand;
}
