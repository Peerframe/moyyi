import type { ActionDigest, EffectId, RunId, SessionId } from "./persisted/index.ts";
import type { ClientCommand, RuntimeEvent } from "./protocol.ts";

/**
 * Local daemon wire protocol, version 1: newline-delimited JSON frames over a private Unix
 * socket. The daemon treats every client frame as untrusted input and validates it here before
 * the runtime sees it; the TypeScript union alone is not a validator. Server frames come from a
 * daemon the client located through owner-only filesystem permissions, so clients check frame
 * shape and size, not transcript semantics.
 */
export const WIRE_PROTOCOL_VERSION = 1;

/** Bounds for one frame, in UTF-8 bytes excluding the newline. */
export const WIRE_LIMITS = Object.freeze({
  helloBytes: 4 * 1024,
  clientFrameBytes: 1024 * 1024,
  serverFrameBytes: 16 * 1024 * 1024,
  idBytes: 256,
  pathBytes: 4096,
  textPartBytes: 256 * 1024,
  inputParts: 64,
  nameBytes: 64,
  digestBytes: 512,
  pageOffset: 1_000_000,
  pageLimit: 1000,
});

export interface WirePluginStatus {
  readonly name: string;
  readonly state: "loaded" | "failed";
  readonly error?: string;
}

/** The part of the runtime protocol a client uses, in process or through the daemon. */
export interface RuntimeClient {
  readonly plugins: readonly WirePluginStatus[];
  readonly diagnostics: readonly string[];
  send(command: ClientCommand): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  idle(): Promise<void>;
  close(): Promise<void>;
}

export type ClientFrame =
  | { readonly type: "hello"; readonly version: number; readonly token: string }
  | { readonly type: "command"; readonly id: number; readonly command: ClientCommand }
  | { readonly type: "idle"; readonly id: number };

export type ServerFrame =
  | {
      readonly type: "welcome";
      readonly version: number;
      /** The only workspace this daemon creates sessions in; its grants are bound to it. */
      readonly workspaceRoot: string;
      readonly plugins: readonly WirePluginStatus[];
      /** Host-authored description of the daemon's fixed grants, shown to the owner. */
      readonly notices: readonly string[];
      readonly diagnostics: readonly string[];
    }
  | { readonly type: "event"; readonly event: RuntimeEvent }
  | { readonly type: "ack"; readonly id: number }
  | { readonly type: "error"; readonly id?: number; readonly message: string };

export class WireError extends Error {
  override readonly name = "WireError";
}

type Json = Record<string, unknown>;

function object(value: unknown, keys: readonly string[], what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new WireError(`${what} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new WireError(`${what} must be a plain object`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new WireError(`${what} has an unexpected field`);
  return value as Json;
}

const encoder = new TextEncoder();
function text(value: unknown, maxBytes: number, what: string, nonEmpty = true): string {
  if (typeof value !== "string") throw new WireError(`${what} must be a string`);
  if (nonEmpty && value.length === 0) throw new WireError(`${what} must not be empty`);
  if (value.length > maxBytes || encoder.encode(value).length > maxBytes)
    throw new WireError(`${what} is too long`);
  if (!value.isWellFormed()) throw new WireError(`${what} must be valid Unicode`);
  return value;
}

function id(value: unknown, what: string): string {
  const result = text(value, WIRE_LIMITS.idBytes, what);
  if (!/^[\x21-\x7e]+$/u.test(result)) throw new WireError(`${what} must be printable ASCII`);
  return result;
}

function integer(value: unknown, max: number, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new WireError(`${what} must be an integer from 0 to ${max}`);
  return value;
}

function frameId(value: unknown): number {
  return integer(value, Number.MAX_SAFE_INTEGER, "Frame id");
}

/** Remote clients send text input only; other content types stay local to trusted hosts. */
function input(value: unknown): { readonly type: "text"; readonly text: string }[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > WIRE_LIMITS.inputParts)
    throw new WireError(`Input must be 1 to ${WIRE_LIMITS.inputParts} parts`);
  return value.map((part) => {
    const checked = object(part, ["type", "text"], "Input part");
    if (checked.type !== "text") throw new WireError("Remote input supports text parts only");
    return { type: "text", text: text(checked.text, WIRE_LIMITS.textPartBytes, "Input text") };
  });
}

function page(value: Json): { offset?: number; limit?: number } {
  return {
    ...(value.offset === undefined
      ? {}
      : { offset: integer(value.offset, WIRE_LIMITS.pageOffset, "Page offset") }),
    ...(value.limit === undefined
      ? {}
      : { limit: integer(value.limit, WIRE_LIMITS.pageLimit, "Page limit") }),
  };
}

/** Rebuilds the command from validated fields, so no unchecked value reaches the runtime. */
export function parseClientCommand(value: unknown): ClientCommand {
  const kind = (value as { type?: unknown } | null)?.type;
  switch (kind) {
    case "plugin.reload": {
      const v = object(value, ["type", "name"], "Command");
      return { type: kind, name: text(v.name, WIRE_LIMITS.nameBytes, "Plugin name") };
    }
    case "session.create": {
      const v = object(value, ["type", "workspaceRoot"], "Command");
      const workspaceRoot = text(v.workspaceRoot, WIRE_LIMITS.pathBytes, "Workspace root");
      if (!workspaceRoot.startsWith("/") || workspaceRoot.includes("\0"))
        throw new WireError("Workspace root must be an absolute path");
      return { type: kind, workspaceRoot };
    }
    case "session.load":
    case "session.compact": {
      const v = object(value, ["type", "sessionId"], "Command");
      return { type: kind, sessionId: id(v.sessionId, "Session id") as SessionId };
    }
    case "session.list": {
      const v = object(value, ["type", "offset", "limit"], "Command");
      return { type: kind, ...page(v) };
    }
    case "session.results": {
      const v = object(value, ["type", "sessionId", "offset", "limit"], "Command");
      return { type: kind, sessionId: id(v.sessionId, "Session id") as SessionId, ...page(v) };
    }
    case "run.start": {
      const v = object(value, ["type", "sessionId", "input"], "Command");
      return {
        type: kind,
        sessionId: id(v.sessionId, "Session id") as SessionId,
        input: input(v.input),
      };
    }
    case "run.steer": {
      const v = object(value, ["type", "runId", "input"], "Command");
      return { type: kind, runId: id(v.runId, "Run id") as RunId, input: input(v.input) };
    }
    case "run.cancel": {
      const v = object(value, ["type", "runId"], "Command");
      return { type: kind, runId: id(v.runId, "Run id") as RunId };
    }
    case "approval.respond": {
      const v = object(value, ["type", "effectId", "digest", "decision"], "Command");
      if (v.decision !== "approve" && v.decision !== "deny")
        throw new WireError("Decision must be approve or deny");
      return {
        type: kind,
        effectId: id(v.effectId, "Effect id") as EffectId,
        digest: text(v.digest, WIRE_LIMITS.digestBytes, "Digest") as ActionDigest,
        decision: v.decision,
      };
    }
    default:
      throw new WireError("Unknown command type");
  }
}

export function parseClientFrame(value: unknown): ClientFrame {
  const kind = (value as { type?: unknown } | null)?.type;
  if (kind === "hello") {
    const v = object(value, ["type", "version", "token"], "Hello");
    return {
      type: kind,
      version: integer(v.version, 1000, "Protocol version"),
      token: text(v.token, 256, "Token"),
    };
  }
  if (kind === "command") {
    const v = object(value, ["type", "id", "command"], "Frame");
    return { type: kind, id: frameId(v.id), command: parseClientCommand(v.command) };
  }
  if (kind === "idle") {
    const v = object(value, ["type", "id"], "Frame");
    return { type: kind, id: frameId(v.id) };
  }
  throw new WireError("Unknown frame type");
}

const eventTypes = new Set<RuntimeEvent["type"]>([
  "plugin.status",
  "session.ready",
  "session.listed",
  "session.results",
  "run.started",
  "assistant.delta",
  "entry.appended",
  "approval.requested",
  "effect.updated",
  "run.finished",
  "command.rejected",
]);

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.length > 256 || value.some((s) => typeof s !== "string"))
    throw new WireError(`${what} must be a bounded string list`);
  return value as string[];
}

/** Shape check only: the client located this daemon through owner-only permissions. */
export function parseServerFrame(value: unknown): ServerFrame {
  const kind = (value as { type?: unknown } | null)?.type;
  switch (kind) {
    case "welcome": {
      const v = object(
        value,
        ["type", "version", "workspaceRoot", "plugins", "notices", "diagnostics"],
        "Welcome",
      );
      if (!Array.isArray(v.plugins) || v.plugins.length > 256)
        throw new WireError("Plugins must be a bounded list");
      const plugins = v.plugins.map((plugin): WirePluginStatus => {
        const p = object(plugin, ["name", "state", "error"], "Plugin status");
        if (p.state !== "loaded" && p.state !== "failed")
          throw new WireError("Plugin state is invalid");
        return {
          name: text(p.name, WIRE_LIMITS.nameBytes, "Plugin name"),
          state: p.state,
          ...(p.error === undefined ? {} : { error: text(p.error, 4096, "Plugin error", false) }),
        };
      });
      return {
        type: kind,
        version: integer(v.version, 1000, "Protocol version"),
        workspaceRoot: text(v.workspaceRoot, WIRE_LIMITS.pathBytes, "Workspace root"),
        plugins,
        notices: strings(v.notices, "Notices"),
        diagnostics: strings(v.diagnostics, "Diagnostics"),
      };
    }
    case "event": {
      const v = object(value, ["type", "event"], "Event frame");
      const event = v.event as { type?: unknown } | null;
      if (
        typeof event !== "object" ||
        event === null ||
        !eventTypes.has(event.type as RuntimeEvent["type"])
      )
        throw new WireError("Unknown event type");
      return { type: kind, event: event as RuntimeEvent };
    }
    case "ack": {
      const v = object(value, ["type", "id"], "Ack");
      return { type: kind, id: frameId(v.id) };
    }
    case "error": {
      const v = object(value, ["type", "id", "message"], "Error frame");
      return {
        type: kind,
        ...(v.id === undefined ? {} : { id: frameId(v.id) }),
        message: text(v.message, 4096, "Error message", false),
      };
    }
    default:
      throw new WireError("Unknown frame type");
  }
}

/** Incremental newline framing with a per-frame byte bound; never buffers past the bound. */
export class FrameDecoder {
  readonly #maxBytes: number;
  #chunks: Uint8Array[] = [];
  #size = 0;
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  /** Returns complete parsed JSON frames; throws WireError on oversize, bad UTF-8 or JSON. */
  push(chunk: Uint8Array): unknown[] {
    const frames: unknown[] = [];
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      if (this.#size + (end - start) > this.#maxBytes) throw new WireError("Frame is too large");
      if (end > start) {
        this.#chunks.push(chunk.subarray(start, end));
        this.#size += end - start;
      }
      if (newline === -1) return frames;
      const bytes = new Uint8Array(this.#size);
      let offset = 0;
      for (const part of this.#chunks) {
        bytes.set(part, offset);
        offset += part.length;
      }
      this.#chunks = [];
      this.#size = 0;
      let line: string;
      try {
        line = this.#decoder.decode(bytes);
      } catch {
        throw new WireError("Frame is not valid UTF-8");
      }
      try {
        frames.push(JSON.parse(line));
      } catch {
        throw new WireError("Frame is not valid JSON");
      }
      start = newline + 1;
    }
  }
}

export function encodeFrame(frame: ClientFrame | ServerFrame, maxBytes: number): string {
  const line = JSON.stringify(frame);
  if (encoder.encode(line).length > maxBytes) throw new WireError("Frame is too large");
  return `${line}\n`;
}
