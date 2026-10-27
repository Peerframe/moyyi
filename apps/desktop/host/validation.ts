import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import type { DesktopCommand } from "../shared.ts";
import { parseSettings, validateApiKey } from "./settings-schema.ts";

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
    case "report.clear":
      exact(["type", "sessionId"]);
      if (!identifier(input.sessionId)) throw invalid();
      break;
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
