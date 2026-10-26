import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FileRead,
  type ModelRequest,
  type ModelStreamEvent,
  type Plugin,
  type RunOutcome,
  type SessionId,
  type ToolCallId,
  type ToolResultPart,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { fileResultValue } from "../support/file-result.ts";
import { sourceDataflowReport } from "../tasks/source-dataflow-report/task.ts";

const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
function calls(
  items: readonly { name: string; args: unknown }[],
  prefix: string,
): ModelStreamEvent[] {
  return [
    ...items.map(
      ({ name, args }, index): ModelStreamEvent => ({
        type: "part_completed",
        index,
        part: {
          type: "tool_call",
          callId: `${prefix}_${index}` as ToolCallId,
          providerCallId: `${prefix}_${index}`,
          providerItemId: null,
          name,
          rawArguments: JSON.stringify(args),
          argumentsSource: "verbatim",
        },
      }),
    ),
    terminal("tool_use"),
  ];
}
function results(request: ModelRequest): ToolResultPart[] {
  return request.messages
    .flatMap((message) => message.content)
    .filter((part): part is ToolResultPart => part.type === "tool_result");
}
export interface NavigationScenarioEvidence {
  readonly kind: "scripted-navigation-to-artifact";
  readonly modelRequests: number;
  readonly networkRequests: 0;
  readonly pathsInFirstRequest: true;
  readonly sourceUnchanged: true;
  readonly unrelatedWriteDenied: true;
  readonly finalToolChoice: "none";
  readonly checker: { readonly passed: true; readonly details: string };
}

/** Real runtime/files/SQLite and original checker; scripted choices are not a quality result. */
export async function runWorkspaceNavigationScenario(): Promise<NavigationScenarioEvidence> {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-navigation-eval-"));
  const workspace = join(directory, "workspace");
  cpSync(sourceDataflowReport.fixtureDir, workspace, { recursive: true });
  const requests: ModelRequest[] = [];
  let runtime: Runtime | undefined;
  let sessionId: SessionId | undefined;
  let outcome: RunOutcome | undefined;
  let scriptedReport: Record<string, unknown> | undefined;
  let networkRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkRequests++;
    throw Error("Network forbidden in navigation conformance");
  };
  const provider: Plugin = {
    name: "navigation-eval-model",
    apiVersion: 1,
    setup(host) {
      host.registerPolicyRule({
        id: "report-only",
        evaluate(request) {
          if (["read", "list", "search"].includes(request.tool)) return null;
          if (
            ["create", "edit"].includes(request.tool) &&
            typeof request.args === "object" &&
            request.args !== null &&
            "path" in request.args &&
            request.args.path === "report.json"
          )
            return null;
          return { kind: "deny", reason: "Only the requested report may change" };
        },
      });
      host.registerModelProvider({
        id: scriptedProfile.origin.provider,
        models: [scriptedProfile],
        createClient: () => ({
          async *stream(request, signal) {
            signal.throwIfAborted();
            requests.push(request);
            const ordinal = requests.length;
            if (ordinal === 1) {
              const part = request.system.find(
                (part) => part.type === "text" && part.text.includes("Workspace paths (JSON"),
              );
              assert(part?.type === "text");
              const navigation = JSON.parse(part.text.split("\n").at(-1) ?? "");
              assert.equal(navigation.truncated, false);
              for (const path of [
                "card.json",
                "src/decode.mjs",
                "src/requests.mjs",
                "src/policy.mjs",
              ])
                assert(navigation.paths.includes(path));
              assert(
                !part.text.includes("capabilityHint"),
                "Overview carries paths, not source or task answers",
              );
              yield* calls(
                (navigation.paths as string[])
                  .filter((path) => path === "card.json" || path.endsWith(".mjs"))
                  .map((path) => ({ name: "read", args: { path } })),
                "inspect",
              );
              return;
            }
            if (ordinal === 2) {
              const files = new Map(
                results(request).map((part) => {
                  const read = fileResultValue<FileRead>(part);
                  return [read.path, read.text];
                }),
              );
              assert(
                files
                  .get("src/decode.mjs")
                  ?.includes("return { title: value.title, source: text }"),
              );
              assert(
                files
                  .get("src/decode.mjs")
                  ?.includes("return { title: value.title, body: value.body }"),
              );
              assert(files.get("src/requests.mjs")?.includes("document: card.source"));
              assert(files.get("src/requests.mjs")?.includes("document: card.body"));
              assert(files.get("src/policy.mjs")?.includes('hostGrants.has("publish")'));
              assert.equal(JSON.parse(files.get("card.json") ?? "").capabilityHint, "publish");
              // A handwritten response exercises delivery, never an answer injected into context.
              // No fixture module is executed and no checker/reference output enters the request.
              scriptedReport = {
                archive: {
                  parserFields: ["title", "source"],
                  hintInDocument: true,
                  publishWithEmptyGrants: false,
                  publishWithHostGrant: true,
                  dataPath: ["src/decode.mjs#decodeArchive", "src/requests.mjs#archiveRequest"],
                },
                delivery: {
                  parserFields: ["title", "body"],
                  hintInDocument: false,
                  publishWithEmptyGrants: false,
                  publishWithHostGrant: true,
                  dataPath: ["src/decode.mjs#decodeDelivery", "src/requests.mjs#deliveryRequest"],
                },
                authority: "src/policy.mjs#canPublish",
              };
              yield* calls(
                [
                  {
                    name: "create",
                    args: { path: "report.json", text: `${JSON.stringify(scriptedReport)}\n` },
                  },
                  { name: "create", args: { path: "forbidden.txt", text: "must not be written" } },
                ],
                "deliver",
              );
              return;
            }
            if (ordinal === 3) {
              const delivered = results(request);
              assert.equal(
                delivered.find((result) => result.callId === "deliver_0")?.status,
                "succeeded",
              );
              assert.equal(
                delivered.find((result) => result.callId === "deliver_1")?.status,
                "denied",
              );
              yield* calls([{ name: "read", args: { path: "report.json" } }], "verify");
              return;
            }
            assert.equal(ordinal, 4);
            assert.equal(request.toolChoice, "none");
            assert.deepEqual(
              JSON.parse(fileResultValue<FileRead>(results(request).at(-1)).text),
              scriptedReport,
            );
            yield {
              type: "part_completed",
              index: 0,
              part: { type: "text", text: "Synthetic file delivery and verification completed." },
            };
            yield terminal("end_turn");
          },
        }),
      });
    },
  };
  try {
    runtime = await createRuntime({
      model: scriptedProfile.origin,
      dataDirectory: join(directory, "data"),
      projectInstructions: false,
      workspaceNavigation: true,
      workspaceWrites: { roots: [workspace], approval: "allow" },
      limits: { timeoutMs: 15_000, maxModelRequests: 4, maxRetries: 0 },
      plugins: [{ plugin: provider }],
    });
    runtime.subscribe((event) => {
      if (event.type === "session.ready") sessionId = event.sessionId;
      if (event.type === "run.finished") outcome = event.outcome;
    });
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    assert(sessionId);
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: sourceDataflowReport.instruction }],
    });
    await runtime.idle();
    assert.deepEqual(outcome, { kind: "completed" });
    assert.equal(requests.length, 4);
    const checker = await sourceDataflowReport.check(workspace);
    assert.equal(checker.passed, true, checker.details);
    assert.equal(networkRequests, 0);
    return {
      kind: "scripted-navigation-to-artifact",
      modelRequests: requests.length,
      networkRequests: 0,
      pathsInFirstRequest: true,
      sourceUnchanged: true,
      unrelatedWriteDenied: true,
      finalToolChoice: "none",
      checker: { passed: true, details: checker.details },
    };
  } finally {
    await runtime?.close();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
}
