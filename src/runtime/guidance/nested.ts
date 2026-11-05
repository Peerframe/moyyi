import type { TranscriptEntry } from "../../contracts/index.ts";

/** Tools whose `path` argument names a workspace file or directory the model worked in. */
const PATH_TOOLS = new Set(["read", "list", "search", "create", "edit", "undo", "read_document"]);
const DIRECTORY_TOOLS = new Set(["list", "search"]);
export const MAX_NESTED_DIRECTORIES = 64;

/**
 * Workspace-relative directories, below the root, that this session's recorded tool calls
 * touched, in order of first use. Derived only from recorded calls, so the instruction files
 * they select can be reconstructed from history. Parents come before their children.
 */
export function touchedDirectories(path: readonly TranscriptEntry[]): string[] {
  const seen = new Set<string>();
  const add = (directory: string) => {
    const parts = directory.split("/");
    for (let index = 1; index <= parts.length; index++) {
      if (seen.size >= MAX_NESTED_DIRECTORIES) return;
      seen.add(parts.slice(0, index).join("/"));
    }
  };
  for (const entry of path) {
    if (entry.body.kind !== "assistant_message") continue;
    for (const part of entry.body.content) {
      if (part.type !== "tool_call" || !PATH_TOOLS.has(part.name)) continue;
      let value: unknown;
      try {
        value = (JSON.parse(part.rawArguments) as { path?: unknown } | null)?.path;
      } catch {
        continue;
      }
      if (typeof value !== "string") continue;
      const normalized = normalize(value);
      if (normalized === undefined) continue;
      const directory = DIRECTORY_TOOLS.has(part.name)
        ? normalized
        : normalized.split("/").slice(0, -1).join("/");
      if (directory) add(directory);
    }
  }
  return [...seen];
}

/** Relative, slash-separated, without `.`, `..` or empty segments; undefined otherwise. */
function normalize(value: string): string | undefined {
  if (value.length > 1024 || value.startsWith("/") || value.includes("\\") || value.includes("\0"))
    return undefined;
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return undefined;
  return parts.join("/");
}
