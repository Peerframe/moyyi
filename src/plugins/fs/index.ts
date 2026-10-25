import {
  type ActionDigest,
  canonicalizeJson,
  type FileList,
  type FileRead,
  type FileSearch,
  type JsonSchema,
  type Plugin,
  type ToolContext,
  type ToolDefinition,
  type ToolOutcome,
} from "../../contracts/index.ts";

import { workspaceWriteTools } from "./writes.ts";

type Operation = "read" | "list" | "search";
interface Arguments {
  readonly path: string;
  readonly maxBytes?: number;
  readonly startLine?: number;
  readonly maxLines?: number;
  readonly maxEntries?: number;
  readonly query?: string;
  readonly maxMatches?: number;
  readonly caseSensitive?: boolean;
  readonly contextLines?: number;
}
type Result =
  | FileRead
  | FileList
  | FileSearch
  | { readonly error: string; readonly truncated: boolean };
const encoder = new TextEncoder();
const pathSchema = { type: "string", minLength: 1, maxLength: 4096 };
const schemas: Record<Operation, JsonSchema> = {
  read: {
    type: "object",
    properties: {
      path: pathSchema,
      maxBytes: { type: "integer", minimum: 1, maximum: 65536 },
      startLine: { type: "integer", minimum: 1, maximum: 1000000 },
      maxLines: { type: "integer", minimum: 1, maximum: 1000 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  list: {
    type: "object",
    properties: { path: pathSchema, maxEntries: { type: "integer", minimum: 1, maximum: 200 } },
    additionalProperties: false,
  },
  search: {
    type: "object",
    properties: {
      path: pathSchema,
      query: { type: "string", minLength: 1, maxLength: 256 },
      maxMatches: { type: "integer", minimum: 1, maximum: 100 },
      caseSensitive: { type: "boolean" },
      contextLines: { type: "integer", minimum: 0, maximum: 20 },
    },
    required: ["query"],
    additionalProperties: false,
  },
};
const descriptions: Record<Operation, string> = {
  read: "Read workspace UTF-8; default prefix 16384 bytes, capped by output budget. For search hits use startLine/maxLines (1-based; defaults 1/200). Range mode needs a complete file <=1 MiB. lineRange.complete concerns the window; truncated means file content omitted. Protected/binary files fail.",
  list: "List bounded entries of a workspace-relative directory (default .). The host enforces protected paths; truncated means the listing is incomplete.",
  search:
    "Literal search in a directory (default .), respecting .gitignore; no regex. Returns hits and merged nearby code (contextLines 0–20 per side, default 8). Complete windows may omit function bodies; use read for gaps. Truncation/skippedFiles cannot prove absence.",
};

export const fsPlugin: Plugin = {
  name: "fs",
  apiVersion: 1,
  setup(host) {
    if (host.config !== undefined) throw new Error("The fs plugin does not accept configuration");
    for (const operation of ["read", "list", "search"] as const) host.registerTool(tool(operation));
    for (const write of workspaceWriteTools()) host.registerTool(write);
  },
};

function tool(operation: Operation): ToolDefinition {
  return {
    name: operation,
    description: descriptions[operation],
    inputSchema: schemas[operation],
    effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
    async prepare(value, context) {
      assertActive(context);
      const args = argumentsFor(operation, value);
      return {
        digest: "runtime-computes-action-digest" as ActionDigest,
        summary: `${operation} ${args.path}`,
        // Read access has no prepared-world assumption. The capability enforces actual paths
        // at execution; a protected path is a refusal, never an approvable stale precondition.
        preconditions: [],
        payload: args,
      };
    },
    async execute(action, context) {
      try {
        assertActive(context);
        if (!context.files) throw new Error("Workspace file capability is unavailable");
        const args = argumentsFor(operation, action.payload);
        const budget = context.limits.maxOutputBytes;
        let result: FileRead | FileList | FileSearch;
        if (operation === "read") {
          result = await context.files.read(args.path, {
            maxBytes: Math.max(1, Math.min(args.maxBytes ?? 16384, Math.floor(budget / 8))),
            ...(args.startLine === undefined ? {} : { startLine: args.startLine }),
            ...(args.maxLines === undefined ? {} : { maxLines: args.maxLines }),
          });
        } else if (operation === "list") {
          result = await context.files.list(args.path, {
            maxEntries: Math.max(1, Math.min(args.maxEntries ?? 50, Math.floor(budget / 256))),
          });
        } else {
          result = await context.files.search(args.path, args.query as string, {
            maxMatches: Math.max(1, Math.min(args.maxMatches ?? 20, Math.floor(budget / 512))),
            caseSensitive: args.caseSensitive ?? true,
            contextLines: args.contextLines ?? 8,
          });
        }
        assertActive(context);
        return outcome("succeeded", result, budget);
      } catch (error) {
        // Capability failures remain failures. No direct-I/O or broader-permission fallback.
        return outcome(
          "failed",
          { error: errorText(error), truncated: false },
          context.limits.maxOutputBytes,
        );
      }
    },
  };
}

function argumentsFor(operation: Operation, value: unknown): Arguments {
  // The executor validates the public schema; snapshotting here also protects direct callers.
  const copied: unknown = JSON.parse(canonicalizeJson(value));
  if (!copied || typeof copied !== "object" || Array.isArray(copied))
    throw new Error("Expected an argument object");
  const args = copied as Record<string, unknown>;
  const allowed = Object.keys(schemas[operation].properties as Record<string, unknown>);
  if (Object.keys(args).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported file-tool argument");
  const path = args.path === undefined ? (operation === "read" ? undefined : ".") : args.path;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 4096 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  )
    throw new Error("Invalid workspace-relative path");
  const optionalLimit = (key: string, maximum: number): number | undefined => {
    const number = args[key];
    if (number === undefined) return undefined;
    if (
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      number > maximum
    )
      throw new Error(`Invalid ${key}`);
    return number;
  };
  if (operation === "read") {
    const maxBytes = optionalLimit("maxBytes", 65536);
    const startLine = optionalLimit("startLine", 1_000_000);
    const maxLines = optionalLimit("maxLines", 1_000);
    return {
      path,
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(startLine === undefined ? {} : { startLine }),
      ...(maxLines === undefined ? {} : { maxLines }),
    };
  }
  if (operation === "list") {
    const maxEntries = optionalLimit("maxEntries", 200);
    return { path, ...(maxEntries === undefined ? {} : { maxEntries }) };
  }
  if (
    typeof args.query !== "string" ||
    !args.query.length ||
    args.query.length > 256 ||
    /[\r\n\0]/.test(args.query)
  )
    throw new Error("Search requires a bounded literal query");
  if (args.caseSensitive !== undefined && typeof args.caseSensitive !== "boolean")
    throw new Error("Invalid caseSensitive");
  const maxMatches = optionalLimit("maxMatches", 100);
  const contextLines = args.contextLines;
  if (
    contextLines !== undefined &&
    (typeof contextLines !== "number" ||
      !Number.isSafeInteger(contextLines) ||
      contextLines < 0 ||
      contextLines > 20)
  )
    throw new Error("Invalid contextLines");
  return {
    path,
    query: args.query,
    caseSensitive: args.caseSensitive ?? true,
    ...(maxMatches === undefined ? {} : { maxMatches }),
    ...(contextLines === undefined ? {} : { contextLines }),
  };
}

function assertActive(context: ToolContext): void {
  if (context.signal.aborted) throw new Error("File operation cancelled");
}

function outcome(status: ToolOutcome["status"], result: Result, budget: number): ToolOutcome {
  const content = (value: unknown) => [{ type: "text" as const, text: canonicalizeJson(value) }];
  const fits = (value: unknown) =>
    encoder.encode(canonicalizeJson(content(value))).byteLength <= budget;
  if (fits(result)) return { status, content: content(result) };
  let limited: unknown = { truncated: true };
  const base = { ...result, truncated: true };
  if ("text" in result) {
    // Generic serialized-output clipping cannot preserve the host's exact line endpoint.
    const { lineRange: _lineRange, ...readBase } = { ...result, truncated: true };
    limited = { ...readBase, text: prefix(result.text, (text) => fits({ ...readBase, text })) };
  } else if ("entries" in result) {
    limited = {
      ...base,
      entries: result.entries.slice(
        0,
        largest(result.entries.length, (length) =>
          fits({ ...base, entries: result.entries.slice(0, length) }),
        ),
      ),
    };
  } else if ("matches" in result) {
    // Keep whole source windows only. Serialized clipping must not retain false endpoints.
    if (result.context) {
      const withEmptyContext = { ...base, context: [] };
      if (fits(withEmptyContext)) {
        const count = largest(result.context.length, (length) =>
          fits({ ...base, context: result.context?.slice(0, length) }),
        );
        return { status, content: content({ ...base, context: result.context.slice(0, count) }) };
      }
      // Preserve hit navigation under a small budget; no windows survive clipped matches.
      return outcome(
        status,
        {
          path: result.path,
          matches: result.matches,
          truncated: true,
          skippedFiles: result.skippedFiles,
        },
        budget,
      );
    }
    const count = largest(result.matches.length, (length) =>
      fits({ ...base, matches: result.matches.slice(0, length) }),
    );
    limited = { ...base, matches: result.matches.slice(0, count) };
    const first = result.matches[0];
    if (count === 0 && first) {
      const text = prefix(first.text, (text) => fits({ ...base, matches: [{ ...first, text }] }));
      if (text) limited = { ...base, matches: [{ ...first, text }] };
    }
  } else {
    limited = {
      error: prefix(result.error, (error) => fits({ error, truncated: true })),
      truncated: true,
    };
  }
  if (!fits(limited)) limited = { truncated: true };
  if (!fits(limited)) throw new Error("File-tool output budget is too small");
  return { status, content: content(limited) };
}

function prefix(value: string, fits: (value: string) => boolean): string {
  const characters = [...value];
  return characters
    .slice(
      0,
      largest(characters.length, (length) => fits(characters.slice(0, length).join(""))),
    )
    .join("");
}

function largest(maximum: number, fits: (length: number) => boolean): number {
  let low = 0,
    high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function errorText(error: unknown): string {
  try {
    return (error instanceof Error ? error.message : String(error))
      .toWellFormed()
      .slice(0, 1024)
      .toWellFormed();
  } catch {
    return "Workspace file operation failed";
  }
}
