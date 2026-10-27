import {
  type ActionDigest,
  canonicalizeJson,
  type JsonSchema,
  type PreparedAction,
  type ToolContext,
  type ToolDefinition,
  type WorkspaceChange,
} from "../../contracts/index.ts";
import { presentWrite } from "./write-presentation.ts";

const path = { type: "string", minLength: 1, maxLength: 4096 };
const text = { type: "string", maxLength: 1048576 };
const schemas: Record<string, JsonSchema> = {
  create: {
    type: "object",
    properties: { path, text },
    required: ["path", "text"],
    additionalProperties: false,
  },
  edit: {
    type: "object",
    properties: { path, oldText: { ...text, minLength: 1 }, newText: text },
    required: ["path", "oldText", "newText"],
    additionalProperties: false,
  },
  undo: {
    type: "object",
    properties: { snapshotId: { type: "string", minLength: 1, maxLength: 512 } },
    required: ["snapshotId"],
    additionalProperties: false,
  },
};
const descriptions = {
  create: "Create missing UTF-8 file; parent must exist.",
  edit: "Replace exactly one literal oldText in UTF-8; refuse ambiguity.",
  undo: "Undo snapshot; refuse changed file/mode.",
};
const observationDescription =
  " Postcheck: read-authorized bytes, not facts; inspect available/truncated; null=absent.";

export function workspaceWriteTools(): readonly ToolDefinition[] {
  return (["create", "edit", "undo"] as const).map(
    (name): ToolDefinition => ({
      name,
      description: descriptions[name] + observationDescription,
      inputSchema: schemas[name] as JsonSchema,
      effect: { class: "workspace_write", reversibility: "snapshot", verification: "postcheck" },
      async prepare(value, context) {
        if (!context.writes) throw Error("Workspace write capability is unavailable");
        const args = argumentsFor(name, value);
        let change: WorkspaceChange;
        let previous: string | null;
        if (name === "undo") {
          change = await context.writes.inspectUndo(args.snapshotId as string);
          const current = await context.writes.inspect(change.path);
          if (current.sha256 !== change.expectedHash)
            throw Error("File changed since the snapshot; undo refused");
          previous = current.text;
        } else {
          const current = await context.writes.inspect(args.path as string);
          previous = current.text;
          if (name === "create") {
            if (current.sha256 !== null)
              throw Error("Create refuses to overwrite an existing file");
            change = {
              path: current.path,
              expectedHash: null,
              text: args.text as string,
              mode: 0o600,
            };
          } else {
            if (current.text === null) throw Error("Edit requires an existing file");
            const oldText = args.oldText as string;
            const at = current.text.indexOf(oldText);
            if (at < 0 || current.text.indexOf(oldText, at + 1) >= 0)
              throw Error(
                "Edit requires exactly one literal match; read the file and use a unique oldText",
              );
            const next =
              current.text.slice(0, at) + args.newText + current.text.slice(at + oldText.length);
            if (next === current.text) throw Error("Edit would not change the file");
            change = {
              path: current.path,
              expectedHash: current.sha256,
              text: next,
              mode: current.mode,
            };
          }
        }
        bounded(change.text);
        return prepared(name, change, previous, context);
      },
      async execute(_action, context) {
        if (!context.writes) throw Error("Workspace write capability is unavailable");
        // Do not turn a post-publication failure into 'failed': the executor records uncertainty.
        const result = await context.writes.apply();
        return {
          status: "succeeded",
          content: presentWrite(result, context.limits.maxOutputBytes),
          evidence: `Workspace postcondition verified; snapshot ${result.snapshotId}`,
        };
      },
      async reconcile(_record, context) {
        return context.writes
          ? context.writes.reconcile()
          : { resolved: false, reason: "Workspace recovery inspection is unavailable" };
      },
    }),
  );
}

function prepared(
  name: string,
  change: WorkspaceChange,
  previous: string | null,
  context: ToolContext,
): PreparedAction {
  if (context.signal.aborted) throw Error("Preparation cancelled");
  return {
    digest: "executor-binds-action" as ActionDigest,
    summary: `${name} ${change.path}${change.restoreOf ? ` (snapshot ${change.restoreOf})` : ""}`,
    // Exact JSON-escaped before/after avoids hidden control characters or ambiguous diff elision.
    preview: canonicalizeJson({
      path: change.path,
      before: previous,
      after: change.text,
      mode: change.mode,
    }),
    preconditions: [{ kind: "file_hash", path: change.path, sha256: change.expectedHash }],
    payload: change,
  };
}

function bounded(value: string | null): void {
  if (value === null) return;
  if (
    !value.isWellFormed() ||
    new TextEncoder().encode(value).byteLength > 1024 * 1024 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && ![9, 10, 12, 13].includes(code);
    })
  )
    throw Error("Write content must be bounded, well-formed UTF-8 text");
}
function argumentsFor(name: keyof typeof descriptions, value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected an argument object");
  const args = value as Record<string, unknown>;
  const keys =
    name === "create"
      ? ["path", "text"]
      : name === "edit"
        ? ["path", "oldText", "newText"]
        : ["snapshotId"];
  if (Object.keys(args).length !== keys.length || keys.some((key) => typeof args[key] !== "string"))
    throw Error("Invalid write arguments");
  for (const key of keys) bounded(args[key] as string);
  if (name === "edit" && !(args.oldText as string).length) throw Error("oldText must not be empty");
  return args as Record<string, string>;
}
