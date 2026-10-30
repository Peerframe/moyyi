import { type ExactKeys, invalid } from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "preferences.load":
    case "skill.dismiss":
      exact(["type"]);
      return { type: input.type };
    case "personal.save":
      exact(["type", "text"]);
      if (
        typeof input.text !== "string" ||
        !input.text.isWellFormed() ||
        Buffer.byteLength(input.text) > 8192 ||
        input.text.includes("\0")
      )
        throw invalid();
      return { type: input.type, text: input.text };
    case "skill.inspect":
      exact(["type", "directory"]);
      if (
        typeof input.directory !== "string" ||
        !input.directory.startsWith("/") ||
        input.directory.length > 8192 ||
        input.directory.includes("\0")
      )
        throw invalid();
      return { type: input.type, directory: input.directory };
    case "skill.import":
      exact(["type", "reviewId"]);
      if (typeof input.reviewId !== "string" || !/^[a-f0-9-]{36}$/.test(input.reviewId))
        throw invalid();
      return { type: input.type, reviewId: input.reviewId };
    case "skill.enable":
      exact(["type", "sha256", "enabled"]);
      if (
        typeof input.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.sha256) ||
        typeof input.enabled !== "boolean"
      )
        throw invalid();
      return { type: input.type, sha256: input.sha256, enabled: input.enabled };
    default:
      throw invalid();
  }
}
