import { desktopStateSchema } from "./native/state-schema.ts";
import {
  choice,
  integer,
  nullableInteger,
  nullableString,
  object,
  string,
} from "./native/state-validation.ts";
import { boundedMessage } from "./security.ts";
import type { DesktopMaintenanceResult, DesktopState } from "./shared.ts";
export function isMaintenanceResult(value: unknown): value is DesktopMaintenanceResult {
  return (
    boundedMessage(value) &&
    object(value, [
      "kind",
      "path",
      "rescuePath",
      "sessionCount",
      "schemaVersion",
      "persistedFormat",
      "targetRevision",
      "settingsPreserved",
      "workspacesUntouched",
      "credentialsExported",
    ]) &&
    Object.keys(value).length === 10 &&
    choice(value.kind, ["backup", "restore", "rollback"]) &&
    string(value.path, 4096) &&
    value.path.startsWith("/") &&
    !value.path.includes("\0") &&
    nullableString(value.rescuePath, 4096) &&
    nullableInteger(value.sessionCount) &&
    nullableInteger(value.schemaVersion) &&
    nullableInteger(value.persistedFormat) &&
    (value.targetRevision === null ||
      (typeof value.targetRevision === "string" && /^[a-f0-9]{40}$/.test(value.targetRevision))) &&
    value.settingsPreserved === true &&
    value.workspacesUntouched === true &&
    value.credentialsExported === false
  );
}

/** Validate every registered slice plus common envelope and identity constraints. */
export function isDesktopState(s: unknown): s is DesktopState {
  if (!desktopStateSchema.validate(s)) return false;
  if (
    s.history &&
    object(s.history, ["sessionId", "workspaceRoot", "items", "nextCursor"]) &&
    (s.history.sessionId !== s.activeSessionId || s.history.workspaceRoot !== s.workspaceRoot)
  )
    return false;
  return true;
}
export type WorkerMessage =
  | { type: "state"; state: DesktopState }
  | { type: "ack"; id: number; error?: string }
  | { type: "fatal"; message: string };

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!boundedMessage(value) || !object(value, ["type", "state", "id", "error", "message"]))
    return false;
  switch (value.type) {
    case "state":
      return Object.keys(value).length === 2 && isDesktopState(value.state);
    case "ack":
      return (
        integer(value.id) &&
        (value.error === undefined || string(value.error, 4096)) &&
        Object.keys(value).every((key) => ["type", "id", "error"].includes(key))
      );
    case "fatal":
      return Object.keys(value).length === 2 && string(value.message, 4096);
    default:
      return false;
  }
}

export function isWorkerRequest(
  value: unknown,
): value is { type: "command"; id: number; command: unknown } {
  return (
    boundedMessage(value, 70_000) &&
    object(value, ["type", "id", "command"]) &&
    Object.keys(value).length === 3 &&
    value.type === "command" &&
    integer(value.id)
  );
}
