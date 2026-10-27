import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";
import type { DesktopCommand } from "../shared.ts";

const invalid = () => new Error("Invalid desktop command");
const containsControl = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 512 && !containsControl(value);

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
      if (
        !Number.isSafeInteger(input.offset) ||
        Number(input.offset) < 0 ||
        Number(input.offset) > 10_000
      )
        throw invalid();
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
    case "close":
      exact(["type"]);
      break;
    default:
      throw invalid();
  }
  return { ...input } as DesktopCommand;
}
