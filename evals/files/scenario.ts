import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FileSearch,
  type ModelRequest,
  type ModelStreamEvent,
  type PermissionPolicy,
  type Plugin,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  type ToolResultPart,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { NodeWorkspaceFiles } from "../../src/runtime/files.ts";
import { createRuntime, ReadOnlyPolicy, type Runtime } from "../../src/runtime/index.ts";

export const fileNavigationScenarios = [
  "exact-file-search-source-and-context",
  "include-exclude-selects-implementation",
  "files-mode-deduplicates-and-bounds",
  "schema-feedback-repaired-without-preparation",
  "selection-preserves-protected-and-ignored-paths",
] as const;
export type FileNavigationScenario = (typeof fileNavigationScenarios)[number];

export interface FileNavigationEvidence {
  readonly kind: "scripted-navigation-mechanism";
  readonly modelRequests: number;
  readonly requestLimit: number;
  readonly retries: 0;
  readonly networkRequests: 0;
  readonly resultStatuses: readonly string[];
  readonly workspaceUnchanged: true;
  readonly exactResultsReachedModel: true;
  readonly invalidCallReachedPreparation: false | null;
  readonly invalidCallCreatedFileCapability: false | null;
}

const sourceLines = [
  "export function publishRecord(value: string) {",
  "  const prepared = value.trim();",
  "  return prepared;",
  "}",
  "export const alias = publishRecord;",
  "// IMPLEMENTATION_BODY_END",
];
const sourceText = `${sourceLines.join("\n")}\n`;
const siblingText = "export const sibling = 'publishRecord SIBLING_ONLY';\n";
const noiseLines = Array.from({ length: 30 }, (_, i) => `// publishRecord TEST_NOISE_${i}`);
const callId = (index: number) => `navigation_${index}` as ToolCallId;
const terminal = (stopReason: "end_turn" | "tool_use"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const calls: Record<FileNavigationScenario, readonly Record<string, unknown>[]> = {
  "exact-file-search-source-and-context": [
    { path: "src/main.ts", query: "publishRecord", contextLines: 1 },
  ],
  "include-exclude-selects-implementation": [
    {
      path: "src",
      query: "publishRecord",
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts", "**/sibling.ts"],
      contextLines: 1,
    },
    {
      path: "src",
      query: "publishRecord",
      include: ["**/*.test.ts"],
      contextLines: 0,
      maxMatches: 2,
    },
  ],
  "files-mode-deduplicates-and-bounds": [
    {
      path: "src",
      query: "publishRecord",
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts"],
      mode: "files",
      contextLines: 20,
    },
    {
      path: "src",
      query: "publishRecord",
      exclude: ["**/*.test.ts"],
      mode: "files",
      maxMatches: 1,
    },
    { path: "src/main.ts", query: "publishRecord", mode: "files" },
  ],
  "schema-feedback-repaired-without-preparation": [
    { path: "src/main.ts", query: "PRIVATE_ARGUMENT_VALUE_845", contextLines: 25 },
    { path: "src/main.ts", query: "publishRecord", contextLines: 1 },
  ],
  "selection-preserves-protected-and-ignored-paths": [
    { query: "BOUNDARY_SECRET", include: ["**/*.txt", ".env"], mode: "files" },
    { path: ".env", query: "BOUNDARY_SECRET", include: [".env"], mode: "files" },
    { path: "outside-link", query: "BOUNDARY_SECRET", mode: "files" },
  ],
};

function response(args: Record<string, unknown>, index: number): readonly ModelStreamEvent[] {
  return [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: callId(index),
        providerCallId: callId(index),
        providerItemId: null,
        name: "search",
        rawArguments: JSON.stringify(args),
        argumentsSource: "verbatim",
      },
    },
    terminal("tool_use"),
  ];
}

function resultText(result: ToolResultPart | undefined): string {
  assert(result);
  const content = result.content[0];
  assert(content?.type === "text");
  return content.text;
}

function value(result: ToolResultPart | undefined): FileSearch {
  assert.equal(result?.status, "succeeded");
  return JSON.parse(resultText(result)) as FileSearch;
}

function checkSource(result: ToolResultPart | undefined): void {
  const data = value(result);
  assert.equal(data.mode, undefined, "Default content mode preserves the original result shape");
  assert.equal(data.files, undefined);
  assert.equal(data.truncated, false);
  assert.deepEqual(data.matches, [
    { path: "src/main.ts", line: 1, text: sourceLines[0] },
    { path: "src/main.ts", line: 5, text: sourceLines[4] },
  ]);
  assert.deepEqual(data.context, [
    {
      path: "src/main.ts",
      startLine: 1,
      endLine: 2,
      text: `${sourceLines.slice(0, 2).join("\n")}\n`,
      complete: true,
    },
    {
      path: "src/main.ts",
      startLine: 4,
      endLine: 6,
      text: `${sourceLines.slice(3, 6).join("\n")}\n`,
      complete: true,
    },
  ]);
  assert.doesNotMatch(resultText(result), /SIBLING_ONLY|TEST_NOISE/);
}

function checkFiles(
  result: ToolResultPart | undefined,
  paths: readonly string[],
  truncated: boolean,
) {
  const data = value(result);
  assert.equal(data.mode, "files");
  assert.deepEqual(data.files?.toSorted(), paths.toSorted());
  assert.deepEqual(data.matches, []);
  assert.equal(data.context, undefined);
  assert.equal(data.truncated, truncated);
  assert.doesNotMatch(resultText(result), /value\.trim|IMPLEMENTATION_BODY_END|SIBLING_ONLY/);
}

/** Real guarded file tools; the scripted response sequence does not measure model understanding. */
export async function runFileNavigationScenario(
  scenario: FileNavigationScenario,
): Promise<FileNavigationEvidence> {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-navigation-eval-"));
  const workspace = join(directory, "workspace");
  let runtime: Runtime | undefined;
  let preparations = 0;
  let capabilities = 0;
  let operations = 0;
  let networkRequests = 0;
  const originalCreate = NodeWorkspaceFiles.prototype.create;
  const originalFetch = globalThis.fetch;
  const events: RuntimeEvent[] = [];
  const entries = new Map<string, TranscriptEntry>();
  const attempts: {
    request: ModelRequest;
    preparations: number;
    capabilities: number;
    operations: number;
  }[] = [];
  try {
    mkdirSync(join(workspace, "src"), { recursive: true });
    mkdirSync(join(workspace, "ignored"));
    const fixture = new Map([
      [join(workspace, "src/main.ts"), sourceText],
      [join(workspace, "src/sibling.ts"), siblingText],
      [join(workspace, "src/a-noise.test.ts"), `${noiseLines.join("\n")}\n`],
      [join(workspace, ".gitignore"), "ignored/\n"],
      [join(workspace, "ignored/key.txt"), "BOUNDARY_SECRET_IGNORED\n"],
      [join(workspace, ".env"), "BOUNDARY_SECRET_ENV\n"],
      [join(directory, "outside.txt"), "BOUNDARY_SECRET_OUTSIDE\n"],
    ]);
    for (const [path, text] of fixture) writeFileSync(path, text);
    symlinkSync(join(directory, "outside.txt"), join(workspace, "outside-link"));

    // Observe capability entry without replacing any confinement, lookup or filesystem operation.
    // This observer is process-local and restored before the next scenario.
    NodeWorkspaceFiles.prototype.create = function (...args) {
      capabilities++;
      const actual = originalCreate.apply(this, args);
      return {
        read: (...args) => {
          operations++;
          return actual.read(...args);
        },
        list: (...args) => {
          operations++;
          return actual.list(...args);
        },
        search: (...args) => {
          operations++;
          return actual.search(...args);
        },
      };
    };
    globalThis.fetch = async () => {
      networkRequests++;
      throw Error("Network is forbidden in navigation conformance");
    };
    const policy = new ReadOnlyPolicy();
    const observedPolicy: PermissionPolicy = {
      revision: () => policy.revision(),
      beforeContextRead: (path) => policy.beforeContextRead(path),
      beforePrepare: (...args) => {
        preparations++;
        return policy.beforePrepare(...args);
      },
      beforeExecute: (...args) => policy.beforeExecute(...args),
    };
    const actions = calls[scenario];
    const provider = scriptedProvider([
      ...actions.map(response),
      [
        {
          type: "part_completed",
          index: 0,
          part: { type: "text", text: "Scripted navigation completed." },
        },
        terminal("end_turn"),
      ],
    ]);
    const observedProvider: Plugin = {
      ...provider.plugin,
      setup(host) {
        host.registerModelProvider({
          id: "scripted",
          models: [scriptedProfile],
          createClient: () => ({
            async *stream(request, signal) {
              attempts.push({ request, preparations, capabilities, operations });
              if (
                scenario === "schema-feedback-repaired-without-preparation" &&
                attempts.length === 2
              ) {
                assert.equal(preparations, 0, "Invalid schema must stop before preparation policy");
                assert.equal(
                  capabilities,
                  0,
                  "Invalid schema must not create a workspace capability",
                );
                assert.equal(operations, 0, "Invalid schema must not enter workspace I/O");
                assert.ok(!events.some((event) => event.type === "effect.updated"));
                const rejected = request.messages
                  .flatMap((message) => message.content)
                  .find((part) => part.type === "tool_result" && part.callId === callId(0));
                assert(rejected?.type === "tool_result");
                assert.equal(rejected.status, "failed");
                assert.match(resultText(rejected), /contextLines/);
                assert.match(resultText(rejected), /20/);
                assert.doesNotMatch(resultText(rejected), /PRIVATE_ARGUMENT_VALUE_845/);
              }
              yield* provider.client.stream(request, signal);
            },
          }),
        });
      },
    };
    const requestLimit = actions.length + 1;
    assert.ok(requestLimit <= 8);
    runtime = await createRuntime({
      dataDirectory: join(directory, "data"),
      model: scriptedProfile.origin,
      projectInstructions: false,
      policy: observedPolicy,
      limits: { timeoutMs: 15000, maxRetries: 0, maxModelRequests: requestLimit },
      plugins: [{ plugin: observedProvider }],
    });
    assert.ok(runtime.plugins.every((plugin) => plugin.state === "loaded"));
    let sessionId: SessionId | undefined;
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "session.ready") sessionId = event.sessionId;
      if (event.type === "entry.appended") entries.set(event.entry.id, event.entry);
    });
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    assert(sessionId);
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [
        { type: "text", text: "Inspect this synthetic workspace using read-only file tools." },
      ],
    });
    await runtime.idle();
    await runtime.send({ type: "session.load", sessionId });
    const finished = events.filter((event) => event.type === "run.finished");
    assert.equal(finished.length, 1);
    assert.deepEqual(finished[0]?.outcome, { kind: "completed" });
    assert.ok(
      !events.some(
        (event) => event.type === "command.rejected" || event.type === "approval.requested",
      ),
    );
    assert.equal(attempts.length, requestLimit);
    assert.equal(provider.client.requests.length, requestLimit);
    assert.equal(provider.client.remaining, 0);
    assert.equal(attempts.at(-1)?.request.toolChoice, "none");
    assert.ok(attempts.slice(0, -1).every(({ request }) => request.toolChoice === undefined));
    const results = [...entries.values()].flatMap((entry) =>
      entry.body.kind === "tool_results" ? entry.body.results : [],
    );
    assert.equal(results.length, actions.length);
    for (const [index, result] of results.entries()) {
      assert.equal(result.callId, callId(index));
      const next = attempts[index + 1]?.request.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === "tool_result" && part.callId === result.callId);
      assert.deepEqual(
        next,
        result,
        "The persisted exact result must reach the next model request",
      );
      assert.ok(Buffer.byteLength(JSON.stringify(result.content)) <= 32 * 1024);
      assert.doesNotMatch(resultText(result), /BOUNDARY_SECRET_(?:IGNORED|ENV|OUTSIDE)/);
    }
    if (scenario === "exact-file-search-source-and-context") {
      assert.equal(value(results[0]).path, "src/main.ts");
      checkSource(results[0]);
    } else if (scenario === "include-exclude-selects-implementation") {
      checkSource(results[0]);
      const tests = value(results[1]);
      assert.deepEqual(
        tests.matches,
        noiseLines.slice(0, 2).map((text, i) => ({
          path: "src/a-noise.test.ts",
          line: i + 1,
          text,
        })),
      );
      assert.equal(tests.context, undefined);
      assert.equal(tests.truncated, true);
    } else if (scenario === "files-mode-deduplicates-and-bounds") {
      checkFiles(results[0], ["src/main.ts", "src/sibling.ts"], false);
      const bounded = value(results[1]);
      assert.equal(bounded.files?.length, 1);
      const retained = bounded.files?.[0];
      assert.ok(retained === "src/main.ts" || retained === "src/sibling.ts");
      checkFiles(results[1], [retained], true);
      checkFiles(results[2], ["src/main.ts"], false);
    } else if (scenario === "schema-feedback-repaired-without-preparation") {
      assert.equal(results[0]?.status, "failed");
      checkSource(results[1]);
      assert.equal(attempts[1]?.capabilities, 0);
      assert.equal(attempts[1]?.preparations, 0);
      assert.equal(attempts[1]?.operations, 0);
      assert.equal(attempts[2]?.operations, 1);
      assert.ok((attempts[2]?.preparations ?? 0) > 0);
    } else {
      checkFiles(results[0], [], false);
      assert.notEqual(results[1]?.status, "succeeded");
      assert.notEqual(results[2]?.status, "succeeded");
    }
    for (const [path, expected] of fixture) assert.equal(readFileSync(path, "utf8"), expected);
    assert.equal(networkRequests, 0);
    return {
      kind: "scripted-navigation-mechanism",
      modelRequests: attempts.length,
      requestLimit,
      retries: 0,
      networkRequests: 0,
      resultStatuses: results.map((result) => result.status),
      workspaceUnchanged: true,
      exactResultsReachedModel: true,
      invalidCallReachedPreparation:
        scenario === "schema-feedback-repaired-without-preparation" ? false : null,
      invalidCallCreatedFileCapability:
        scenario === "schema-feedback-repaired-without-preparation" ? false : null,
    };
  } finally {
    try {
      await runtime?.close();
    } finally {
      NodeWorkspaceFiles.prototype.create = originalCreate;
      globalThis.fetch = originalFetch;
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
