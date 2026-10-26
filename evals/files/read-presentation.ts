import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FileRead,
  type ModelRequest,
  type ModelStreamEvent,
  type Plugin,
  type SessionId,
  type ToolCallId,
  type ToolResultPart,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { fileResultValue } from "../support/file-result.ts";

export const fileReadPresentationScenarios = [
  "numbered-source-reaches-next-request",
  "partial-line-continuation-rereads-tail",
  "serialized-read-output-bound",
  "default-budget-keeps-fitting-single-line",
  "default-prefix-has-no-implicit-line-cap",
] as const;
export type FileReadPresentationScenario = (typeof fileReadPresentationScenarios)[number];
export interface FileReadPresentationEvidence {
  readonly kind: "scripted-read-presentation-mechanism";
  readonly modelRequests: number;
  readonly networkRequests: 0;
  readonly originalSourcePreserved: true;
  readonly exactTextReachedModel: true;
  readonly resultParts: readonly number[];
}

function completed(stopReason: "end_turn" | "tool_use"): ModelStreamEvent {
  return { type: "completed", stopReason, providerStopReason: null, usage: UNKNOWN_USAGE };
}
function call(args: unknown, ordinal: number): ModelStreamEvent[] {
  const id = `presentation_${ordinal}`;
  return [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: id as ToolCallId,
        providerCallId: id,
        providerItemId: null,
        name: "read",
        rawArguments: JSON.stringify(args),
        argumentsSource: "verbatim",
      },
    },
    completed("tool_use"),
  ];
}
function results(request: ModelRequest): ToolResultPart[] {
  return request.messages
    .flatMap((message) => message.content)
    .filter((part): part is ToolResultPart => part.type === "tool_result");
}

/** Real runtime/files/SQLite; scripted choices measure source presentation, not model quality. */
export async function runFileReadPresentationScenario(
  scenario: FileReadPresentationScenario,
): Promise<FileReadPresentationEvidence> {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-read-presentation-"));
  let runtime: Runtime | undefined;
  const requests: ModelRequest[] = [];
  const originalFetch = globalThis.fetch;
  let networks = 0;
  const partial = scenario === "partial-line-continuation-rereads-tail";
  const bounded = scenario === "serialized-read-output-bound";
  const longLine = scenario === "default-budget-keeps-fitting-single-line";
  const manyLines = scenario === "default-prefix-has-no-implicit-line-cap";
  const source = partial
    ? "first\nalpha🙂suffix\r\nlast\n"
    : bounded
      ? "x\n".repeat(200)
      : longLine
        ? `${JSON.stringify({ note: "x".repeat(6000), status: "PENDING_REVIEW" })}\n`
        : manyLines
          ? `${"item\n".repeat(240)}TAIL_FACT\n`
          : 'export const raw = "字😀";\r\n1: original prefix\nlone\rcarriage\u2028separator\nno final LF';
  const sourcePath = join(directory, "source.txt");
  const requestLimit = partial ? 3 : 2;
  const useDefaultBudget = longLine || manyLines;
  const outputLimit = bounded ? 512 : useDefaultBudget ? 32768 : 8192;
  try {
    writeFileSync(sourcePath, source);
    globalThis.fetch = async () => {
      networks++;
      throw Error("Network is forbidden in read presentation conformance");
    };
    const provider: Plugin = {
      name: "read-presentation-model",
      apiVersion: 1,
      setup(host) {
        host.registerModelProvider({
          id: "scripted",
          models: [scriptedProfile],
          createClient: () => ({
            async *stream(request, signal) {
              signal.throwIfAborted();
              requests.push(request);
              const ordinal = requests.length;
              if (ordinal === 1) {
                yield* call(
                  partial
                    ? { path: "source.txt", startLine: 2, maxLines: 1, maxBytes: 8 }
                    : { path: "source.txt" },
                  ordinal,
                );
                return;
              }
              const result = results(request).at(-1);
              assert(result);
              assert.equal(result.status, "succeeded");
              assert.ok(Buffer.byteLength(JSON.stringify(result.content)) <= outputLimit);
              const evidence = fileResultValue<FileRead>(result);
              const first = result.content[0];
              assert(first?.type === "text");
              const metadata = JSON.parse(first.text);
              assert.equal(metadata.format, "file-read-v1");
              assert.equal("text" in metadata, false);
              assert.equal(result.content.length, 2);
              if (partial && ordinal === 2) {
                assert.equal(evidence.text, "alpha");
                assert.equal(metadata.presentation.lastLineComplete, false);
                assert.equal(metadata.presentation.nextRead.startLine, 2);
                yield* call(
                  { ...metadata.presentation.nextRead, maxLines: 1, maxBytes: 65536 },
                  ordinal,
                );
                return;
              }
              if (partial) {
                assert.equal(evidence.text, "alpha🙂suffix\r\n");
                assert.equal(metadata.presentation.lastLineComplete, true);
              } else if (bounded) {
                assert.ok(evidence.text.length > 0);
                assert.ok(source.startsWith(evidence.text));
                assert.equal(evidence.truncated, true);
                assert.equal(metadata.presentation.outputTruncated, true);
                assert.equal(metadata.presentation.lastLineComplete, true);
                assert.equal(evidence.text.endsWith("\n"), true);
                assert.equal(
                  metadata.presentation.nextRead.startLine,
                  metadata.presentation.endLine + 1,
                );
              } else {
                assert.equal(evidence.text, source);
                assert.equal(evidence.truncated, false);
                assert.equal(metadata.presentation.lastLineComplete, true);
                assert.equal(metadata.presentation.outputTruncated, false);
                assert.equal(metadata.presentation.nextRead, undefined);
                assert.equal(metadata.presentation.sourceBytes, Buffer.byteLength(source));
                if (longLine) assert.equal(JSON.parse(evidence.text).status, "PENDING_REVIEW");
                if (manyLines) assert.equal(metadata.presentation.endLine, 241);
              }
              assert.equal(request.toolChoice, "none");
              yield {
                type: "part_completed",
                index: 0,
                part: { type: "text", text: "Scripted source presentation verified." },
              };
              yield completed("end_turn");
            },
          }),
        });
      },
    };
    runtime = await createRuntime({
      dataDirectory: join(directory, "data"),
      model: scriptedProfile.origin,
      projectInstructions: false,
      limits: {
        timeoutMs: 15_000,
        maxRetries: 0,
        maxModelRequests: requestLimit,
        ...(useDefaultBudget ? {} : { maxToolOutputBytes: outputLimit }),
      },
      plugins: [{ plugin: provider }],
    });
    let sessionId: SessionId | undefined;
    let outcome: string | undefined;
    runtime.subscribe((event) => {
      if (event.type === "session.ready") sessionId = event.sessionId;
      if (event.type === "run.finished") outcome = event.outcome.kind;
    });
    await runtime.send({ type: "session.create", workspaceRoot: directory });
    assert(sessionId);
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Inspect the synthetic source." }],
    });
    await runtime.idle();
    assert.equal(outcome, "completed");
    assert.equal(requests.length, requestLimit);
    assert.equal(readFileSync(sourcePath, "utf8"), source);
    assert.equal(networks, 0);
    return {
      kind: "scripted-read-presentation-mechanism",
      modelRequests: requests.length,
      networkRequests: 0,
      originalSourcePreserved: true,
      exactTextReachedModel: true,
      resultParts: results(requests.at(-1) as ModelRequest).map((result) => result.content.length),
    };
  } finally {
    await runtime?.close();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
}
