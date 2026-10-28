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

function publicHttps(value: unknown, originOnly = false): boolean {
  const maxBytes = originOnly ? 4096 : 8192;
  if (
    !string(value, maxBytes) ||
    new TextEncoder().encode(value).byteLength > maxBytes ||
    !value.isWellFormed() ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\",
    )
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.hostname.includes(".") &&
      !url.hostname.endsWith(".") &&
      !/^[\d.]+$/.test(url.hostname) &&
      !url.hostname.startsWith("[") &&
      !/(?:^|\.)(?:localhost|local|internal|invalid)$/.test(url.hostname) &&
      value === (originOnly ? url.origin : url.href)
    );
  } catch {
    return false;
  }
}

function webAccess(value: unknown): boolean {
  return (
    object(value, ["allowedOrigins", "dns"]) &&
    choice(value.dns, ["system", "cloudflare-doh"]) &&
    Array.isArray(value.allowedOrigins) &&
    value.allowedOrigins.length <= 8 &&
    new Set(value.allowedOrigins).size === value.allowedOrigins.length &&
    value.allowedOrigins.every((origin) => publicHttps(origin, true))
  );
}

function sources(value: unknown): boolean {
  return (
    object(value, ["items", "truncated"]) &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.items) &&
    value.items.length <= 20 &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262_144 &&
    value.items.every(
      (v) =>
        object(v, [
          "id",
          "entryId",
          "callId",
          "url",
          "status",
          "contentType",
          "title",
          "text",
          "truncated",
          "displayTruncated",
          "recordedAt",
          "textSha256",
        ]) &&
        string(v.entryId, 128) &&
        v.entryId.length > 0 &&
        string(v.callId, 512) &&
        v.callId.length > 0 &&
        // A source identity combines two independently bounded IDs and their separator.
        string(v.id, 128 + 1 + 512) &&
        v.id === `${v.entryId}:${v.callId}` &&
        publicHttps(v.url) &&
        integer(v.status) &&
        Number(v.status) >= 200 &&
        Number(v.status) < 300 &&
        string(v.contentType, 512) &&
        v.contentType.isWellFormed() &&
        (v.title === null || (string(v.title, 512) && v.title.isWellFormed())) &&
        string(v.text, 16_384) &&
        v.text.isWellFormed() &&
        typeof v.truncated === "boolean" &&
        typeof v.displayTruncated === "boolean" &&
        string(v.recordedAt, 128) &&
        Number.isFinite(Date.parse(v.recordedAt)) &&
        new Date(v.recordedAt).toISOString() === v.recordedAt &&
        string(v.textSha256, 71) &&
        /^sha256:[a-f0-9]{64}$/.test(v.textSha256),
    )
  );
}

/** Validate the data projection even though the child is a fixed, parent-owned process. */
export function isDesktopState(s: unknown): s is DesktopState {
  if (
    !boundedMessage(s) ||
    !object(s, [
      "status",
      "connection",
      "settings",
      "materials",
      "reportTarget",
      "permissions",
      "webAccess",
      "sources",
      "openedHistory",
      "effects",
      "effectInspection",
      "artifacts",
      "artifactPreview",
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
    !object(s.settings, [
      "preset",
      "maxRequests",
      "timeoutMs",
      "kimiReasoningEffort",
      "evidenceAnswer",
    ]) ||
    !choice(s.settings.preset, ["flash", "kimi-cn", "kimi-global"]) ||
    !integer(s.settings.maxRequests) ||
    Number(s.settings.maxRequests) < 1 ||
    Number(s.settings.maxRequests) > 8 ||
    !integer(s.settings.timeoutMs) ||
    Number(s.settings.timeoutMs) < 30_000 ||
    Number(s.settings.timeoutMs) > 300_000 ||
    (s.settings.kimiReasoningEffort !== undefined &&
      !choice(s.settings.kimiReasoningEffort, ["low", "high"])) ||
    (s.settings.preset === "flash" && s.settings.kimiReasoningEffort === "high") ||
    (s.settings.evidenceAnswer !== undefined && typeof s.settings.evidenceAnswer !== "boolean") ||
    (s.settings.evidenceAnswer === true && Number(s.settings.maxRequests) < 2)
  )
    return false;
  const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const nullableHash = (value: unknown) => value === null || hash(value);
  if (
    !object(s.permissions, ["writes", "checks"]) ||
    typeof s.permissions.writes !== "boolean" ||
    typeof s.permissions.checks !== "boolean" ||
    !webAccess(s.webAccess) ||
    !sources(s.sources) ||
    typeof s.openedHistory !== "boolean"
  )
    return false;
  const receipt = (v: unknown) =>
    v === null ||
    (object(v, ["kind", "path", "snapshotId", "beforeHash", "afterHash"]) &&
      v.kind === "file" &&
      string(v.path, 4096) &&
      string(v.snapshotId, 128) &&
      nullableHash(v.beforeHash) &&
      nullableHash(v.afterHash)) ||
    (object(v, ["kind", "exitCode", "termination", "outputTruncated"]) &&
      v.kind === "process" &&
      (v.exitCode === null || Number.isSafeInteger(v.exitCode)) &&
      choice(v.termination, [
        "exited",
        "cancelled",
        "timeout",
        "output_limit",
        "revoked",
        "unknown",
      ]) &&
      typeof v.outputTruncated === "boolean");
  if (
    !object(s.effects, ["items", "offset", "hasMore"]) ||
    !integer(s.effects.offset) ||
    typeof s.effects.hasMore !== "boolean" ||
    !Array.isArray(s.effects.items) ||
    s.effects.items.length > 20 ||
    !s.effects.items.every(
      (v) =>
        object(v, ["effectId", "runId", "tool", "state", "updatedAt", "receipt"]) &&
        string(v.effectId, 128) &&
        string(v.runId, 128) &&
        string(v.tool, 256) &&
        string(v.updatedAt, 128) &&
        choice(v.state, [
          "intended",
          "awaiting_approval",
          "approved",
          "denied",
          "started",
          "succeeded",
          "failed",
          "cancelled",
          "unknown",
        ]) &&
        receipt(v.receipt),
    )
  )
    return false;
  if (
    s.effectInspection !== null &&
    !(
      object(s.effectInspection, ["effectId", "path", "state", "expectedHash", "actualHash"]) &&
      string(s.effectInspection.effectId, 128) &&
      string(s.effectInspection.path, 4096) &&
      choice(s.effectInspection.state, [
        "current",
        "changed",
        "missing",
        "absent",
        "unavailable",
      ]) &&
      nullableHash(s.effectInspection.expectedHash) &&
      nullableHash(s.effectInspection.actualHash)
    )
  )
    return false;
  if (
    !nullableString(s.reportTarget, 4096) ||
    !Array.isArray(s.materials) ||
    s.materials.length > 8 ||
    !s.materials.every(
      (v) =>
        object(v, ["path", "format", "sourceBytes", "sha256"]) &&
        string(v.path, 4096) &&
        choice(v.format, ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"]) &&
        integer(v.sourceBytes) &&
        Number(v.sourceBytes) <= 10 * 1024 * 1024 &&
        hash(v.sha256),
    )
  )
    return false;
  if (
    !object(s.artifacts, ["items", "offset", "hasMore"]) ||
    !integer(s.artifacts.offset) ||
    typeof s.artifacts.hasMore !== "boolean" ||
    !Array.isArray(s.artifacts.items) ||
    s.artifacts.items.length > 20 ||
    !s.artifacts.items.every(
      (v) =>
        object(v, ["effectId", "path", "afterHash", "state"]) &&
        string(v.effectId, 128) &&
        string(v.path, 4096) &&
        hash(v.afterHash) &&
        choice(v.state, ["unchecked", "current", "changed", "missing", "unavailable"]),
    )
  )
    return false;
  if (
    s.artifactPreview !== null &&
    !(
      object(s.artifactPreview, [
        "effectId",
        "path",
        "sha256",
        "text",
        "sourceBytes",
        "truncated",
      ]) &&
      string(s.artifactPreview.effectId, 128) &&
      string(s.artifactPreview.path, 4096) &&
      hash(s.artifactPreview.sha256) &&
      string(s.artifactPreview.text, 65_536) &&
      integer(s.artifactPreview.sourceBytes) &&
      Number(s.artifactPreview.sourceBytes) <= 1_048_576 &&
      typeof s.artifactPreview.truncated === "boolean"
    )
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
