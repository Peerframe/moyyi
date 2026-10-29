import type { StateInitialization } from "../../native/contract.ts";
import {
  choice,
  integer,
  nullableInteger,
  nullableString,
  object,
  string,
} from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";

function sessionMetadata(v: unknown): boolean {
  return (
    object(v, ["title", "group", "pinned", "muted", "removedAt", "revision"]) &&
    Object.keys(v).length === 6 &&
    nullableString(v.title, 160) &&
    nullableString(v.group, 80) &&
    typeof v.pinned === "boolean" &&
    typeof v.muted === "boolean" &&
    nullableString(v.removedAt, 128) &&
    integer(v.revision)
  );
}
function catalogQuery(v: unknown): boolean {
  return (
    object(v, ["search", "group", "removed", "cursor", "limit"]) &&
    (v.search === undefined || string(v.search, 160)) &&
    (v.group === undefined || nullableString(v.group, 80)) &&
    (v.removed === undefined || choice(v.removed, ["active", "removed", "all"])) &&
    (v.cursor === undefined || string(v.cursor, 4096)) &&
    (v.limit === undefined || (integer(v.limit) && Number(v.limit) >= 1 && Number(v.limit) <= 50))
  );
}
function historyView(v: unknown): boolean {
  return (
    v === null ||
    (object(v, ["sessionId", "workspaceRoot", "items", "nextCursor"]) &&
      Object.keys(v).length === 4 &&
      string(v.sessionId, 128) &&
      string(v.workspaceRoot, 4096) &&
      nullableString(v.nextCursor, 4096) &&
      Array.isArray(v.items) &&
      v.items.length <= 50 &&
      new TextEncoder().encode(JSON.stringify(v.items)).length <= 262144 &&
      v.items.every(
        (m) =>
          object(m, [
            "id",
            "entryId",
            "role",
            "text",
            "tool",
            "state",
            "recordedAt",
            "textLength",
            "truncated",
          ]) &&
          string(m.id, 1024) &&
          string(m.entryId, 512) &&
          choice(m.role, ["user", "assistant", "tool", "notice"]) &&
          string(m.text, 16384) &&
          (m.tool === undefined || string(m.tool, 512)) &&
          (m.state === undefined || string(m.state, 256)) &&
          string(m.recordedAt, 128) &&
          integer(m.textLength) &&
          typeof m.truncated === "boolean",
      ))
  );
}
export function validateState(s: Record<string, unknown>): boolean {
  if (
    (s.catalog !== undefined &&
      !(
        object(s.catalog, ["query", "nextCursor"]) &&
        catalogQuery(s.catalog.query) &&
        nullableString(s.catalog.nextCursor, 4096)
      )) ||
    (s.history !== undefined && !historyView(s.history)) ||
    (s.historyOnly !== undefined && typeof s.historyOnly !== "boolean") ||
    (s.messageDetail !== undefined &&
      s.messageDetail !== null &&
      !(
        object(s.messageDetail, ["text", "totalLength", "nextOffset", "messageId", "offset"]) &&
        string(s.messageDetail.messageId, 1024) &&
        integer(s.messageDetail.offset) &&
        string(s.messageDetail.text, 16384) &&
        integer(s.messageDetail.totalLength) &&
        nullableInteger(s.messageDetail.nextOffset)
      ))
  )
    return false;
  if (
    s.activeMetadata !== undefined &&
    s.activeMetadata !== null &&
    !sessionMetadata(s.activeMetadata)
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
        object(v, ["sessionId", "workspaceRoot", "lastActivityAt", "promptPreview", "metadata"]) &&
        (v.metadata === undefined || sessionMetadata(v.metadata)) &&
        string(v.sessionId, 128) &&
        string(v.workspaceRoot, 4096) &&
        nullableString(v.lastActivityAt, 128) &&
        nullableString(v.promptPreview, 4096),
    )
  )
    return false;
  if (!nullableString(s.activeSessionId, 128) || !nullableString(s.workspaceRoot, 4096))
    return false;
  if (typeof s.openedHistory !== "boolean") return false;
  return true;
}
export function initialState(_context: StateInitialization): FeatureState {
  return {
    openedHistory: false,
    sessions: { items: [], offset: 0, hasMore: false },
    activeSessionId: null,
    workspaceRoot: null,
  };
}
