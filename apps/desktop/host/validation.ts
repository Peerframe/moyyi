import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import type { DesktopCommand } from "../shared.ts";
import { parseSettings, validateApiKey } from "./settings-schema.ts";
import { normalizeDesktopWebAccess } from "./web.ts";

const invalid = () => new Error("Invalid desktop command");
const containsControl = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 512 && !containsControl(value);
const path = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= 4096 &&
  !containsControl(value);
const page = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000;

/** Validate the untrusted boundary before casting to the trusted runtime protocol. */
export function parseDesktopCommand(value: unknown): DesktopCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length) throw invalid();
  if (Object.values(descriptors).some((field) => !("value" in field))) throw invalid();
  const input = value as Record<string, unknown>;
  const exact = (keys: readonly string[]) => {
    if (
      Object.keys(descriptors).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(descriptors, key))
    )
      throw invalid();
  };
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
    case "approve":
      exact(["type", "effectId", "digest", "decision"]);
      if (
        !identifier(input.effectId) ||
        !identifier(input.digest) ||
        (input.decision !== "approve" && input.decision !== "deny")
      )
        throw invalid();
      break;
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
    case "web.permissions": {
      exact(["type", "sessionId", "allowedOrigins", "dns"]);
      if (!identifier(input.sessionId)) throw invalid();
      const access = normalizeDesktopWebAccess({
        allowedOrigins: input.allowedOrigins,
        dns: input.dns,
      });
      return { type: "web.permissions", sessionId: input.sessionId, ...access };
    }
    case "permissions":
      exact(["type", "sessionId", "writes", "checks"]);
      if (
        !identifier(input.sessionId) ||
        typeof input.writes !== "boolean" ||
        typeof input.checks !== "boolean"
      )
        throw invalid();
      break;
    case "material.remove":
      exact(["type", "sessionId", "path"]);
      if (!identifier(input.sessionId) || !path(input.path)) throw invalid();
      break;
    case "report.target":
      exact(["type", "sessionId", "path"]);
      if (!identifier(input.sessionId) || (input.path !== null && !path(input.path)))
        throw invalid();
      break;
    case "material.cancel":
    case "report.clear":
      exact(["type", "sessionId"]);
      if (!identifier(input.sessionId)) throw invalid();
      break;
    case "library":
    case "artifacts":
    case "effects":
      exact(["type", "sessionId", "offset"]);
      if (!identifier(input.sessionId) || !page(input.offset)) throw invalid();
      break;
    case "artifact.open":
    case "effect.inspect":
      exact(["type", "sessionId", "effectId"]);
      if (!identifier(input.sessionId) || !identifier(input.effectId)) throw invalid();
      break;
    case "artifact.close":
      exact(["type"]);
      break;
    case "close":
      exact(["type"]);
      break;
    default:
      throw invalid();
  }
  return { ...input } as DesktopCommand;
}
