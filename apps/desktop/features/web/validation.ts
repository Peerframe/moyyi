import { type ExactKeys, identifier, invalid } from "../../host/validation-primitives.ts";
import { normalizeDesktopWebAccess } from "../../host/web.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "web.permissions": {
      exact(["type", "sessionId", "allowedOrigins", "dns"]);
      if (!identifier(input.sessionId)) throw invalid();
      const access = normalizeDesktopWebAccess({
        allowedOrigins: input.allowedOrigins,
        dns: input.dns,
      });
      return { type: "web.permissions", sessionId: input.sessionId, ...access };
    }
    default:
      throw invalid();
  }
}
