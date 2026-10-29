import { isAbsolute } from "node:path";
import {
  type ExactKeys,
  identifier,
  invalid,
  page,
  path,
} from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "materials.import":
      exact(["type", "sessionId", "paths"]);
      if (
        !identifier(input.sessionId) ||
        !Array.isArray(input.paths) ||
        input.paths.length < 1 ||
        input.paths.length > 8 ||
        !input.paths.every((p) => path(p) && isAbsolute(p))
      )
        throw invalid();
      break;
    case "material.select":
      exact(["type", "sessionId", "ids"]);
      if (
        !identifier(input.sessionId) ||
        !Array.isArray(input.ids) ||
        input.ids.length > 8 ||
        !input.ids.every(identifier)
      )
        throw invalid();
      break;
    case "material.recycle":
    case "material.restore":
    case "material.purge":
    case "material.preview":
      exact(["type", "sessionId", "id", "revision"]);
      if (
        !identifier(input.sessionId) ||
        !identifier(input.id) ||
        !Number.isSafeInteger(input.revision) ||
        Number(input.revision) < 0
      )
        throw invalid();
      break;
    case "material.housekeeping":
      exact(["type", "sessionId", "enabled"]);
      if (!identifier(input.sessionId) || typeof input.enabled !== "boolean") throw invalid();
      break;
    case "materials":
      exact(["type", "sessionId", "paths"]);
      if (
        !identifier(input.sessionId) ||
        !Array.isArray(input.paths) ||
        input.paths.length > 8 ||
        !input.paths.every(path)
      )
        throw invalid();
      return { type: "materials", sessionId: input.sessionId, paths: [...input.paths] };
    case "material.remove":
      exact(["type", "sessionId", "path"]);
      if (!identifier(input.sessionId) || !path(input.path)) throw invalid();
      break;
    case "material.cancel":
      exact(["type", "sessionId"]);
      if (!identifier(input.sessionId)) throw invalid();
      break;
    case "library":
      exact(["type", "sessionId", "offset"]);
      if (!identifier(input.sessionId) || !page(input.offset)) throw invalid();
      break;
    default:
      throw invalid();
  }
  return { ...input } as FeatureCommand;
}
