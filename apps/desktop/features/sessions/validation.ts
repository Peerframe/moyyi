import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import {
  containsControl,
  type ExactKeys,
  identifier,
  invalid,
  page,
} from "../../host/validation-primitives.ts";
import type { FeatureCommand } from "./contract.ts";
export function validateCommand(input: Record<string, unknown>, exact: ExactKeys): FeatureCommand {
  switch (input.type) {
    case "create":
      exact(["type", "workspaceRoot", "askEachRead"]);
      if (
        typeof input.workspaceRoot !== "string" ||
        !isAbsolute(input.workspaceRoot) ||
        Buffer.byteLength(input.workspaceRoot) > 4096 ||
        containsControl(input.workspaceRoot) ||
        typeof input.askEachRead !== "boolean"
      )
        throw invalid();
      break;
    case "load":
      exact(["type", "sessionId", "askEachRead"]);
      if (!identifier(input.sessionId) || typeof input.askEachRead !== "boolean") throw invalid();
      break;
    case "list":
      exact(["type", "offset"]);
      if (!page(input.offset)) throw invalid();
      break;
    case "catalog": {
      exact(["type", "query"]);
      if (!input.query || typeof input.query !== "object" || Array.isArray(input.query))
        throw invalid();
      const q = input.query as Record<string, unknown>;
      if (
        Object.keys(q).some(
          (k) => !["search", "group", "removed", "cursor", "limit"].includes(k),
        ) ||
        (q.search !== undefined && (typeof q.search !== "string" || q.search.length > 160)) ||
        (q.group !== undefined &&
          q.group !== null &&
          (typeof q.group !== "string" || q.group.length > 80)) ||
        (q.removed !== undefined && !["active", "removed", "all"].includes(String(q.removed))) ||
        (q.cursor !== undefined && (typeof q.cursor !== "string" || q.cursor.length > 4096)) ||
        (q.limit !== undefined &&
          (!Number.isSafeInteger(q.limit) || Number(q.limit) < 1 || Number(q.limit) > 50))
      )
        throw invalid();
      break;
    }
    case "session.update": {
      exact(["type", "update"]);
      if (!input.update || typeof input.update !== "object" || Array.isArray(input.update))
        throw invalid();
      const u = input.update as Record<string, unknown>;
      if (
        Object.keys(u).sort().join() !== "expectedRevision,patch,sessionId" ||
        !identifier(u.sessionId) ||
        !Number.isSafeInteger(u.expectedRevision) ||
        Number(u.expectedRevision) < 0 ||
        !u.patch ||
        typeof u.patch !== "object" ||
        Array.isArray(u.patch)
      )
        throw invalid();
      const p = u.patch as Record<string, unknown>;
      if (
        !Object.keys(p).length ||
        Object.keys(p).some((k) => !["title", "group", "pinned", "muted", "removed"].includes(k)) ||
        (p.title !== undefined &&
          p.title !== null &&
          (typeof p.title !== "string" || p.title.length > 160 || containsControl(p.title))) ||
        (p.group !== undefined &&
          p.group !== null &&
          (typeof p.group !== "string" || p.group.length > 80 || containsControl(p.group))) ||
        ["pinned", "muted", "removed"].some((k) => p[k] !== undefined && typeof p[k] !== "boolean")
      )
        throw invalid();
      break;
    }
    case "history":
      exact(input.cursor === undefined ? ["type", "sessionId"] : ["type", "sessionId", "cursor"]);
      if (
        !identifier(input.sessionId) ||
        (input.cursor !== undefined &&
          (typeof input.cursor !== "string" || input.cursor.length > 4096))
      )
        throw invalid();
      break;
    case "history.message":
      exact(["type", "sessionId", "messageId", "offset"]);
      if (
        !identifier(input.sessionId) ||
        typeof input.messageId !== "string" ||
        input.messageId.length > 1024 ||
        !Number.isSafeInteger(input.offset) ||
        Number(input.offset) < 0
      )
        throw invalid();
      break;
    case "history.close":
      exact(["type"]);
      break;
    default:
      throw invalid();
  }
  return { ...input } as FeatureCommand;
}
