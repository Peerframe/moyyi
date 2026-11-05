import { describe, expect, it } from "vitest";
import type { ToolCallId, TranscriptEntry } from "../../contracts/index.ts";
import { MAX_NESTED_DIRECTORIES, touchedDirectories } from "./nested.ts";

function calls(...list: [string, unknown][]): TranscriptEntry[] {
  return [
    {
      body: {
        kind: "assistant_message",
        content: list.map(([name, args], index) => ({
          type: "tool_call",
          callId: `c${index}` as ToolCallId,
          providerCallId: `c${index}`,
          providerItemId: null,
          name,
          rawArguments: typeof args === "string" ? args : JSON.stringify(args),
          argumentsSource: "verbatim",
        })),
      },
    } as unknown as TranscriptEntry,
  ];
}

describe("touched directories", () => {
  it("collects parent directories of files and the directories that were listed or searched", () => {
    expect(
      touchedDirectories(
        calls(
          ["read", { path: "src/core/index.ts" }],
          ["list", { path: "docs" }],
          ["search", { path: "./evals/tasks/", query: "x" }],
          ["edit", { path: "src/core/executor.ts" }],
          ["read", { path: "README.md" }],
        ),
      ),
    ).toEqual(["src", "src/core", "docs", "evals", "evals/tasks"]);
  });

  it("ignores other tools, escapes, absolute paths and malformed arguments", () => {
    expect(
      touchedDirectories(
        calls(
          ["shell", { command: "cat a/b.txt", cwd: "a" }],
          ["read", { path: "../outside/x.ts" }],
          ["read", { path: "/etc/passwd" }],
          ["read", { path: "a\\\\b.txt" }],
          ["read", "{not json"],
          ["read", { path: 7 }],
          ["list", { path: "." }],
        ),
      ),
    ).toEqual([]);
  });

  it("is bounded", () => {
    const many = Array.from(
      { length: 100 },
      (_, i) => ["read", { path: `d${i}/f.ts` }] as [string, unknown],
    );
    expect(touchedDirectories(calls(...many))).toHaveLength(MAX_NESTED_DIRECTORIES);
  });
});
