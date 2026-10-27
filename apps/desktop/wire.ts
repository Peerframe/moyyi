import { boundedMessage } from "./security.ts";
import type { DesktopState } from "./shared.ts";

function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
function string(value: unknown, max = 262_144): value is string {
  return typeof value === "string" && value.length <= max;
}
function nullableString(value: unknown, max = 262_144): boolean {
  return value === null || string(value, max);
}
function integer(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function nullableInteger(value: unknown): boolean {
  return value === null || integer(value);
}
function choice(value: unknown, choices: string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}

/** Validate the data projection even though the child is a fixed, parent-owned process. */
export function isDesktopState(s: unknown): s is DesktopState {
  if (
    !boundedMessage(s) ||
    !object(s, [
      "status",
      "connection",
      "sessions",
      "activeSessionId",
      "workspaceRoot",
      "model",
      "budgets",
      "askEachRead",
      "messages",
      "historyTruncated",
      "streamText",
      "run",
      "outcome",
      "pendingApproval",
      "error",
    ])
  )
    return false;
  if (
    !choice(s.status, ["ready", "closing", "closed"]) ||
    !object(s.connection, ["ready", "message"]) ||
    typeof s.connection.ready !== "boolean" ||
    (s.connection.message !== undefined && !string(s.connection.message, 4096))
  )
    return false;
  if (
    !object(s.sessions, ["items", "offset", "hasMore"]) ||
    !integer(s.sessions.offset) ||
    typeof s.sessions.hasMore !== "boolean" ||
    !Array.isArray(s.sessions.items) ||
    s.sessions.items.length > 50
  )
    return false;
  if (
    !s.sessions.items.every(
      (v: unknown) =>
        object(v, ["sessionId", "workspaceRoot", "lastActivityAt", "promptPreview"]) &&
        string(v.sessionId, 128) &&
        string(v.workspaceRoot, 4096) &&
        nullableString(v.lastActivityAt, 128) &&
        nullableString(v.promptPreview, 4096),
    )
  )
    return false;
  if (!nullableString(s.activeSessionId, 128) || !nullableString(s.workspaceRoot, 4096))
    return false;
  if (
    s.model !== null &&
    !(
      object(s.model, ["provider", "model"]) &&
      string(s.model.provider, 128) &&
      string(s.model.model, 128)
    )
  )
    return false;
  if (
    !object(s.budgets, ["maxRequests", "timeoutMs", "maxOutputTokens"]) ||
    !nullableInteger(s.budgets.maxRequests) ||
    !nullableInteger(s.budgets.timeoutMs) ||
    !nullableInteger(s.budgets.maxOutputTokens)
  )
    return false;
  if (
    typeof s.askEachRead !== "boolean" ||
    typeof s.historyTruncated !== "boolean" ||
    !string(s.streamText) ||
    !nullableString(s.error, 4096)
  )
    return false;
  if (
    !Array.isArray(s.messages) ||
    s.messages.length > 400 ||
    !s.messages.every(
      (v: unknown) =>
        object(v, ["id", "role", "text", "tool", "state"]) &&
        string(v.id, 256) &&
        choice(v.role, ["user", "assistant", "tool", "notice"]) &&
        string(v.text) &&
        (v.tool === undefined || string(v.tool, 256)) &&
        (v.state === undefined || string(v.state, 256)),
    )
  )
    return false;
  if (
    s.run !== null &&
    !(
      object(s.run, ["id", "state"]) &&
      string(s.run.id, 128) &&
      choice(s.run.state, ["running", "cancelling"])
    )
  )
    return false;
  if (
    s.outcome !== null &&
    !(
      object(s.outcome, ["kind", "detail"]) &&
      choice(s.outcome.kind, ["completed", "cancelled", "budget_exhausted", "failed"]) &&
      (s.outcome.detail === undefined || string(s.outcome.detail, 4096))
    )
  )
    return false;
  return (
    s.pendingApproval === null ||
    (object(s.pendingApproval, ["effectId", "digest", "summary", "preview"]) &&
      string(s.pendingApproval.effectId, 128) &&
      string(s.pendingApproval.digest, 256) &&
      string(s.pendingApproval.summary, 32768) &&
      (s.pendingApproval.preview === undefined || string(s.pendingApproval.preview)))
  );
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
