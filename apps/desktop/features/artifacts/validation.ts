import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import { containsControl, identifier, invalid, page, path, type ExactKeys } from "../../host/validation-primitives.ts";
import { parseSettings, validateApiKey } from "../../host/settings-schema.ts";
import { normalizeDesktopWebAccess } from "../../host/web.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "report.target":
      exact(["type", "sessionId", "path"]);
      if (!identifier(input.sessionId) || (input.path !== null && !path(input.path)))
        throw invalid();
      break;
    case "report.clear":
      exact(["type", "sessionId"]);
      if (!identifier(input.sessionId)) throw invalid();
      break;
    case "artifacts":
      exact(["type", "sessionId", "offset"]);
      if (!identifier(input.sessionId) || !page(input.offset)) throw invalid();
      break;
    case "artifact.open":
      exact(["type", "sessionId", "effectId"]);
      if (!identifier(input.sessionId) || !identifier(input.effectId)) throw invalid();
      break;
    case "artifact.close":
      exact(["type"]);
      break;
    default: throw invalid();
  }
  return { ...input } as FeatureCommand;
}
