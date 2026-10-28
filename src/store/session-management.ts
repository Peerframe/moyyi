import { Buffer } from "node:buffer";
import type { DatabaseSync } from "node:sqlite";
import type {
  ManagedSessionPage,
  ManagedSessionSummary,
  SessionHistoryMessage,
  SessionHistoryPage,
  SessionHistoryQuery,
  SessionMessageChunk,
  SessionMessageQuery,
  SessionQuery,
  SessionUpdate,
} from "../contracts/history.ts";
import type { SessionId, Timestamp, TranscriptEntry } from "../contracts/persisted/index.ts";
import { canonicalizeJson } from "../contracts/replay.ts";
import { encodeEntry } from "./records.ts";

export const SESSION_METADATA_SQL = `CREATE TABLE session_metadata (
          session_id TEXT PRIMARY KEY REFERENCES sessions(id),
          title TEXT, group_name TEXT,
          pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
          muted INTEGER NOT NULL CHECK (muted IN (0, 1)),
          removed_at TEXT, revision INTEGER NOT NULL CHECK (revision > 0)
        ) STRICT;`;

const TEXT_LIMIT = 16_384;
const PAGE_BYTES = 262_144;
const MAX_SCAN = 100;

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  // Reject accessors and lossy values before reading any caller-controlled property.
  canonicalizeJson(value);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid session request");
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error("Invalid session request");
  return value as Record<string, unknown>;
}

function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 512)
    throw Error("Invalid session identity");
}

function integer(value: unknown, minimum: number, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    throw Error("Invalid session page");
}

function name(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum || /\p{Cc}/u.test(value))
    throw Error("Invalid session name");
  return value.trim() || null;
}

function cursor(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value || value.length > 4096 || !/^[\w-]+$/u.test(value))
    throw Error("Invalid session cursor");
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw Error();
    return decoded as Record<string, unknown>;
  } catch {
    throw Error("Invalid session cursor");
  }
}

function token(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function safeEnd(text: string, end: number): number {
  return end < text.length && end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1] ?? "")
    ? end - 1
    : end;
}

const SUMMARY_SQL = `SELECT s.id, s.workspace_root,
  COALESCE((SELECT ordinal FROM entries WHERE session_id=s.id ORDER BY ordinal DESC LIMIT 1),0) AS latest,
  (SELECT json_extract(payload,'$.createdAt') FROM entries WHERE session_id=s.id ORDER BY ordinal DESC LIMIT 1) AS last_activity,
  (SELECT substr(json_extract(part.value,'$.text'),1,160)
   FROM entries prompt, json_each(prompt.payload,'$.body.content') part
   WHERE prompt.ordinal=(SELECT ordinal FROM entries WHERE session_id=s.id
     AND json_extract(payload,'$.body.kind')='user_message' ORDER BY ordinal DESC LIMIT 1)
     AND json_extract(part.value,'$.type')='text' ORDER BY CAST(part.key AS INTEGER) LIMIT 1) AS preview,
  m.title, m.group_name, COALESCE(m.pinned,0) AS pinned, COALESCE(m.muted,0) AS muted,
  m.removed_at, COALESCE(m.revision,0) AS revision
  FROM sessions s LEFT JOIN session_metadata m ON m.session_id=s.id`;

function summary(row: Record<string, unknown>): ManagedSessionSummary {
  identity(row.id);
  if (typeof row.workspace_root !== "string" || row.workspace_root.length > 4096)
    throw Error("Invalid session workspace");
  for (const value of [row.last_activity, row.removed_at])
    if (value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))
      throw Error("Invalid session timestamp");
  if (row.preview !== null && typeof row.preview !== "string")
    throw Error("Invalid session preview");
  if (![0, 1].includes(row.pinned as number) || ![0, 1].includes(row.muted as number))
    throw Error("Invalid session metadata");
  integer(row.revision, 0, Number.MAX_SAFE_INTEGER);
  const preview = row.preview === null ? null : (row.preview as string);
  return {
    sessionId: row.id as SessionId,
    workspaceRoot: row.workspace_root,
    lastActivityAt: row.last_activity as Timestamp | null,
    promptPreview: preview === null ? null : preview.slice(0, safeEnd(preview, 160)),
    metadata: {
      title: name(row.title, 160),
      group: name(row.group_name, 80),
      pinned: row.pinned === 1,
      muted: row.muted === 1,
      removedAt: row.removed_at as Timestamp | null,
      revision: row.revision,
    },
  };
}

export class SqliteSessionManagement {
  private readonly db: DatabaseSync;
  private readonly ready: () => void;

  constructor(db: DatabaseSync, ready: () => void) {
    this.db = db;
    this.ready = ready;
  }

  async list(input: SessionQuery = {}): Promise<ManagedSessionPage> {
    this.ready();
    const query = record(input, ["search", "group", "removed", "cursor", "limit"]);
    const search = query.search === undefined ? "" : (name(query.search, 160) ?? "");
    const group = query.group === undefined ? undefined : name(query.group, 80);
    const removed = query.removed ?? "active";
    if (!["active", "removed", "all"].includes(removed as string))
      throw Error("Invalid session filter");
    const limit = query.limit ?? 20;
    integer(limit, 1, 50);
    const generation = this.db
      .prepare(`SELECT
      (SELECT COUNT(*) FROM sessions) AS count,
      (SELECT COALESCE(MAX(ordinal),0) FROM entries) AS latest,
      (SELECT COALESCE(SUM(revision),0) FROM session_metadata) AS revision`)
      .get();
    const binding = JSON.stringify([
      search,
      group ?? null,
      group === undefined,
      removed,
      generation,
    ]);
    let position: [number, number, string] | null = null;
    if (query.cursor !== undefined) {
      const c = cursor(query.cursor);
      if (c.kind !== "catalog" || c.binding !== binding)
        throw Error("Session catalog changed; refresh the list");
      integer(c.pinned, 0, 1);
      integer(c.latest, 0, Number.MAX_SAFE_INTEGER);
      identity(c.id);
      position = [c.pinned, c.latest, c.id];
    }
    const where = ["1=1"];
    const parameters: (string | number | null)[] = [];
    if (search) {
      where.push("instr(lower(COALESCE(title,preview,'')),lower(?)) > 0");
      parameters.push(search);
    }
    if (group !== undefined) {
      where.push("group_name IS ?");
      parameters.push(group);
    }
    if (removed !== "all")
      where.push(removed === "removed" ? "removed_at IS NOT NULL" : "removed_at IS NULL");
    if (position) {
      where.push("(pinned < ? OR (pinned = ? AND (latest < ? OR (latest = ? AND id > ?))))");
      parameters.push(position[0], position[0], position[1], position[1], position[2]);
    }
    const rows = this.db
      .prepare(`WITH catalog AS (${SUMMARY_SQL}) SELECT * FROM catalog
      WHERE ${where.join(" AND ")} ORDER BY pinned DESC, latest DESC, id ASC LIMIT ?`)
      .all(...parameters, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(summary),
      nextCursor:
        rows.length > limit && last
          ? token({
              kind: "catalog",
              binding,
              pinned: last.pinned,
              latest: last.latest,
              id: last.id,
            })
          : null,
    };
  }

  async update(input: SessionUpdate, now: Timestamp): Promise<ManagedSessionSummary> {
    this.ready();
    const change = record(input, ["sessionId", "expectedRevision", "patch"]);
    identity(change.sessionId);
    integer(change.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1);
    const patch = record(change.patch, ["title", "group", "pinned", "muted", "removed"]);
    if (!Object.keys(patch).length) throw Error("Empty session update");
    if (typeof now !== "string" || !Number.isFinite(Date.parse(now)))
      throw Error("Invalid session timestamp");
    for (const key of ["pinned", "muted", "removed"])
      if (key in patch && typeof patch[key] !== "boolean") throw Error("Invalid session update");
    const title = "title" in patch ? name(patch.title, 160) : undefined;
    const group = "group" in patch ? name(patch.group, 80) : undefined;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`${SUMMARY_SQL} WHERE s.id=?`).get(change.sessionId);
      if (!row) throw Error("Session not found");
      const previous = summary(row).metadata;
      if (previous.revision !== change.expectedRevision)
        throw Error("Session changed; refresh before editing");
      if (
        patch.removed === true &&
        (this.db
          .prepare("SELECT 1 FROM runs WHERE session_id=? AND status='active' LIMIT 1")
          .get(change.sessionId) ||
          this.db
            .prepare(`SELECT 1 FROM effects e JOIN runs r ON r.id=e.run_id WHERE r.session_id=?
          AND e.state IN ('intended','awaiting_approval','approved','started','unknown') LIMIT 1`)
            .get(change.sessionId) ||
          this.db
            .prepare(
              "SELECT 1 FROM workspace_leases l JOIN runs r ON r.id=l.run_id WHERE r.session_id=? LIMIT 1",
            )
            .get(change.sessionId))
      )
        throw Error("Session has unsettled work; it cannot be removed");
      const next = {
        ...previous,
        ...(title !== undefined ? { title } : {}),
        ...(group !== undefined ? { group } : {}),
        ...(typeof patch.pinned === "boolean" ? { pinned: patch.pinned } : {}),
        ...(typeof patch.muted === "boolean" ? { muted: patch.muted } : {}),
        removedAt:
          patch.removed === true
            ? (previous.removedAt ?? now)
            : patch.removed === false
              ? null
              : previous.removedAt,
        revision: previous.revision + 1,
      };
      this.db
        .prepare(`INSERT INTO session_metadata VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET title=excluded.title,group_name=excluded.group_name,
        pinned=excluded.pinned,muted=excluded.muted,removed_at=excluded.removed_at,revision=excluded.revision`)
        .run(
          change.sessionId,
          next.title,
          next.group,
          Number(next.pinned),
          Number(next.muted),
          next.removedAt,
          next.revision,
        );
      this.db.exec("COMMIT");
      return { ...summary(row), metadata: next };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async history(input: SessionHistoryQuery): Promise<SessionHistoryPage> {
    this.ready();
    const query = record(input, ["sessionId", "cursor", "limit"]);
    identity(query.sessionId);
    const limit = query.limit ?? 20;
    integer(limit, 1, 50);
    const session = this.db
      .prepare("SELECT workspace_root FROM sessions WHERE id=?")
      .get(query.sessionId);
    if (!session) throw Error("Session not found");
    let ordinal = Number.MAX_SAFE_INTEGER;
    let part: number | null = null;
    if (query.cursor !== undefined) {
      const c = cursor(query.cursor);
      if (c.kind !== "history" || c.session !== query.sessionId)
        throw Error("Invalid session cursor");
      integer(c.ordinal, 0, Number.MAX_SAFE_INTEGER);
      if (c.part !== null) integer(c.part, 0, Number.MAX_SAFE_INTEGER);
      ordinal = c.ordinal;
      part = c.part as number | null;
    }
    const messages: SessionHistoryMessage[] = [];
    let bytes = 2;
    let scans = 0;
    let nextCursor: string | null = null;
    const continuation = (o: number, p: number | null) =>
      token({ kind: "history", session: query.sessionId, ordinal: o, part: p });
    while (ordinal > 0) {
      const row = this.db
        .prepare(
          "SELECT ordinal,id,payload FROM entries WHERE session_id=? AND ordinal<=? ORDER BY ordinal DESC LIMIT 1",
        )
        .get(query.sessionId, ordinal);
      if (!row) break;
      const current = row.ordinal as number;
      const entry = JSON.parse(row.payload as string) as TranscriptEntry;
      encodeEntry(entry);
      if (entry.sessionId !== query.sessionId || entry.id !== row.id)
        throw Error("Session history identity mismatch");
      const projected = this.project(entry);
      const end = current === ordinal && part !== null ? part : projected.length;
      if (end > projected.length) throw Error("Invalid session cursor");
      for (let index = end - 1; index >= 0; index--) {
        const full = projected[index];
        if (!full) throw Error("Invalid history projection");
        const text = full.text.slice(0, safeEnd(full.text, TEXT_LIMIT));
        const item = {
          ...full,
          text,
          textLength: full.text.length,
          truncated: text.length < full.text.length,
        };
        const size = Buffer.byteLength(JSON.stringify(item)) + (messages.length ? 1 : 0);
        if (messages.length >= limit || bytes + size > PAGE_BYTES) {
          nextCursor = continuation(current, index + 1);
          break;
        }
        messages.push(item);
        bytes += size;
      }
      if (nextCursor) break;
      ordinal = current - 1;
      part = null;
      if (++scans >= MAX_SCAN) {
        if (
          this.db
            .prepare("SELECT 1 FROM entries WHERE session_id=? AND ordinal<=? LIMIT 1")
            .get(query.sessionId, ordinal)
        )
          nextCursor = continuation(ordinal, null);
        break;
      }
    }
    return {
      sessionId: query.sessionId as SessionId,
      workspaceRoot: session.workspace_root as string,
      items: messages.reverse(),
      nextCursor,
    };
  }

  async readMessage(input: SessionMessageQuery): Promise<SessionMessageChunk> {
    this.ready();
    const query = record(input, ["sessionId", "messageId", "offset", "limit"]);
    identity(query.sessionId);
    if (typeof query.messageId !== "string" || query.messageId.length > 600)
      throw Error("Invalid message identity");
    const separator = query.messageId.lastIndexOf(":");
    const entryId = query.messageId.slice(0, separator);
    const suffix = query.messageId.slice(separator + 1);
    if (separator < 1 || !/^\d+$/u.test(suffix)) throw Error("Invalid message identity");
    const row = this.db
      .prepare("SELECT payload FROM entries WHERE session_id=? AND id=?")
      .get(query.sessionId, entryId);
    if (!row) throw Error("Message not found");
    const entry = JSON.parse(row.payload as string) as TranscriptEntry;
    encodeEntry(entry);
    if (entry.sessionId !== query.sessionId || entry.id !== entryId)
      throw Error("Session history identity mismatch");
    const message = this.project(entry).find((item) => item.id === query.messageId);
    if (!message) throw Error("Message not found");
    const offset = query.offset ?? 0;
    const limit = query.limit ?? TEXT_LIMIT;
    integer(offset, 0, message.text.length);
    integer(limit, 2, TEXT_LIMIT);
    if (offset > 0 && /[\uD800-\uDBFF]/u.test(message.text[offset - 1] ?? ""))
      throw Error("Invalid text boundary");
    const end = safeEnd(message.text, Math.min(message.text.length, offset + limit));
    return {
      text: message.text.slice(offset, end),
      totalLength: message.text.length,
      nextOffset: end < message.text.length ? end : null,
    };
  }

  private project(
    entry: TranscriptEntry,
  ): Omit<SessionHistoryMessage, "textLength" | "truncated">[] {
    const items: Omit<SessionHistoryMessage, "textLength" | "truncated">[] = [];
    const add = (
      role: SessionHistoryMessage["role"],
      text: string,
      extra: { tool?: string; state?: string } = {},
      index = items.length,
    ) => {
      items.push({
        id: `${entry.id}:${index}`,
        entryId: entry.id,
        role,
        text,
        recordedAt: entry.createdAt,
        ...extra,
      });
    };
    const body = entry.body;
    if (body.kind === "user_message" || body.kind === "assistant_message") {
      for (const [index, part] of body.content.entries()) {
        if (part.type === "text" || part.type === "refusal")
          add(body.kind === "user_message" ? "user" : "assistant", part.text, {}, index);
        else if (part.type === "tool_call")
          add(
            "tool",
            `${part.name} ${part.rawArguments}`,
            { tool: part.name, state: "requested" },
            index,
          );
        else if (part.type === "image")
          add(
            "notice",
            "An image is retained in history; this text view does not display it.",
            {},
            index,
          );
      }
      if (
        body.kind === "assistant_message" &&
        ["interrupted", "max_tokens"].includes(body.stopReason)
      )
        add(
          "notice",
          body.stopReason === "interrupted"
            ? "This response was interrupted; recorded text is partial."
            : "The model reached its output limit; recorded text is partial.",
          { state: body.stopReason },
          body.content.length,
        );
    } else if (body.kind === "tool_results") {
      for (const result of body.results) {
        const calls = this.db
          .prepare(`SELECT json_extract(p.value,'$.name') AS name
          FROM entries e, json_each(e.payload,'$.body.content') p
          WHERE e.session_id=? AND e.run_id IS ? AND json_extract(e.payload,'$.body.kind')='assistant_message'
          AND e.ordinal < (SELECT ordinal FROM entries WHERE id=?)
          AND json_extract(p.value,'$.type')='tool_call' AND json_extract(p.value,'$.callId')=? LIMIT 2`)
          .all(entry.sessionId, entry.runId, entry.id, result.callId);
        const tool =
          calls.length === 1 && typeof calls[0]?.name === "string" ? calls[0].name : "tool";
        add(
          "tool",
          result.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
          { tool, state: result.status },
        );
      }
    } else if (body.kind === "notice") add("notice", body.text);
    else if (body.kind === "compaction")
      add(
        "notice",
        `Earlier conversation was summarized; original entries remain in history.\n${body.summary.map((part) => part.text).join("\n")}`,
        { state: "compaction" },
      );
    return items;
  }
}
