import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelClient,
  type ModelProfile,
  type Plugin,
  parseStrictJson,
  type RunId,
  type RunOutcome,
  type SessionId,
  type TranscriptEntry,
  UNKNOWN_USAGE,
  type Usage,
} from "../../src/contracts/index.ts";
import { createRuntime, type Runtime, type RuntimeOptions } from "../../src/runtime/index.ts";
import type { AgentInput, AgentReport, AgentUnderTest } from "../harness/types.ts";

export interface RuntimeEvalHost {
  readonly source: "synthetic" | "live";
  readonly profile: ModelProfile;
  /** Trusted, lazy construction. Each client obeys the one-request/no-retry model port. */
  createClient(): ModelClient;
  readonly toolchain?: {
    readonly executablePaths?: readonly string[];
    readonly readOnlyPaths?: readonly string[];
  };
}

export interface MoyyiEvalOptions extends RuntimeEvalHost {
  /** Shared across every turn and trial attempted by this adapter. Not a money ceiling. */
  readonly maxModelRequests: number;
  readonly capabilities?: "read" | "write" | "shell";
  readonly allowLive?: boolean;
}

export interface MoyyiEvalAgent extends AgentUnderTest {
  readonly modelRequests: number;
  readonly source: "synthetic" | "live";
  close(): Promise<void>;
}

const reportPlugin: Plugin = {
  name: "eval-report",
  apiVersion: 1,
  setup(host) {
    host.registerContextSource({
      id: "eval-report",
      async collect() {
        return [
          {
            id: "eval-report-v1",
            stability: "static",
            content: [
              {
                type: "text",
                text:
                  'For this evaluation client, return the final user-facing answer as one JSON object with exactly two properties: "status" and "summary". ' +
                  'Use status "done" only when you claim the requested task is completed, or "blocked" when you report that you could not complete it. ' +
                  "summary must be a nonempty natural-language explanation of the actual result and any limitation. Do not wrap the object in Markdown. " +
                  "This output format supplies no task facts, permission or expected answer. Do not create an extra report file unless the user requested one.",
              },
            ],
          },
        ];
      },
    });
  },
};

/** No prose heuristics, file/checker access, earlier-message scan or end_turn inference. */
export function parseFinalClaim(text: string): boolean | null {
  try {
    const value = parseStrictJson(text, 64 * 1024);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const report = value as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (
      keys.join(",") !== "status,summary" ||
      typeof report.summary !== "string" ||
      !report.summary.trim()
    )
      return null;
    return report.status === "done" ? true : report.status === "blocked" ? false : null;
  } catch {
    return null;
  }
}

interface TrialSession {
  readonly dataDirectory: string;
  readonly workspace: string;
  readonly instructions: string[];
  sessionId?: SessionId;
  active: boolean;
}

export function createMoyyiEvalAgent(options: MoyyiEvalOptions): MoyyiEvalAgent {
  if (!Number.isSafeInteger(options.maxModelRequests) || options.maxModelRequests < 1)
    throw Error("A positive suite-wide model request limit is required");
  if (!["synthetic", "live"].includes(options.source) || typeof options.createClient !== "function")
    throw Error("An explicit model source and client factory are required");
  if (options.source === "live" && options.allowLive !== true)
    throw Error("Live evaluation requires explicit allowLive and a bounded request authorization");
  const capabilities = options.capabilities ?? "read";
  if (!["read", "write", "shell"].includes(capabilities))
    throw Error("Invalid eval capability profile");
  const trials = new Map<string, TrialSession>();
  let modelRequests = 0;
  let closed = false;
  let busy = false;
  // This reservation happens before client construction/stream invocation, so retries, turns and
  // subsequent trials cannot create another client call after the shared quota is consumed.
  const provider: Plugin = {
    name: "eval-provider",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: options.profile.origin.provider,
        models: [options.profile],
        createClient() {
          let client: ModelClient | undefined;
          return {
            async *stream(request, signal) {
              if (signal.aborted || closed || modelRequests >= options.maxModelRequests) {
                yield {
                  type: "error",
                  error: {
                    kind: signal.aborted ? "cancelled" : "invalid_request",
                    message: "Evaluation request allowance unavailable",
                    partialOutput: false,
                    usage: UNKNOWN_USAGE,
                  },
                };
                return;
              }
              modelRequests++;
              try {
                client ??= options.createClient();
                yield* client.stream(request, signal);
              } catch {
                yield {
                  type: "error",
                  error: {
                    kind: signal.aborted ? "cancelled" : "network",
                    message: "Evaluation model client failed",
                    partialOutput: true,
                    usage: UNKNOWN_USAGE,
                  },
                };
              }
            },
          };
        },
      });
    },
  };

  const disposeTrial = async (sessionId: string) => {
    const state = trials.get(sessionId);
    if (!state) return;
    if (state.active) throw Error("Cannot dispose an active evaluation turn");
    trials.delete(sessionId);
    await rm(state.dataDirectory, { recursive: true, force: true });
  };

  return {
    name: "moyyi",
    source: options.source,
    get modelRequests() {
      return modelRequests;
    },
    disposeTrial,
    async close() {
      if (busy) throw Error("Cancel and await the active turn before closing the adapter");
      closed = true;
      for (const id of trials.keys()) await disposeTrial(id);
    },
    async run(input: AgentInput): Promise<AgentReport> {
      if (busy) throw Error("Evaluation turns must run sequentially");
      busy = true;
      try {
        const before = modelRequests;
        if (closed) throw Error("Evaluation adapter is closed");
        if (input.signal.aborted)
          return { claimedSuccess: null, modelRequests: 0, outcome: "cancelled" };
        if (modelRequests >= options.maxModelRequests)
          return { claimedSuccess: null, modelRequests: 0, outcome: "budget_exhausted" };
        if (
          !Number.isSafeInteger(input.budget.maxModelRequests) ||
          input.budget.maxModelRequests < 1 ||
          !Number.isFinite(input.budget.timeoutMs) ||
          input.budget.timeoutMs <= 0
        )
          throw Error("Invalid remaining trial budget");
        const workspace = await realpath(input.workspace);
        let state = trials.get(input.sessionId);
        if (!state) {
          if (input.turnIndex !== 0 || input.priorInstructions.length !== 0)
            throw Error("The first evaluation turn must have an empty history");
          state = {
            dataDirectory: await mkdtemp(join(tmpdir(), "moyyi-eval-state-")),
            workspace,
            instructions: [],
            active: false,
          };
          trials.set(input.sessionId, state);
        }
        if (
          state.active ||
          state.workspace !== workspace ||
          input.turnIndex !== state.instructions.length ||
          JSON.stringify(input.priorInstructions) !== JSON.stringify(state.instructions)
        )
          throw Error("Evaluation conversation identity/order changed");
        state.active = true;
        let runtime: Runtime | undefined;
        let runId: RunId | undefined;
        let outcome: RunOutcome | undefined;
        let rejected = false;
        const entries = new Map<string, TranscriptEntry>();
        const cancel = () => {
          if (runId && runtime) void runtime.send({ type: "run.cancel", runId }).catch(() => {});
        };
        let unsubscribe = () => {};
        try {
          const runtimeOptions: RuntimeOptions = {
            model: options.profile.origin,
            dataDirectory: state.dataDirectory,
            plugins: [{ plugin: provider }, { plugin: reportPlugin }],
            limits: {
              maxModelRequests: Math.min(
                input.budget.maxModelRequests,
                options.maxModelRequests - modelRequests,
              ),
              timeoutMs: Math.max(1, Math.floor(input.budget.timeoutMs)),
              maxRetries: 0,
            },
            ...(capabilities === "read"
              ? {}
              : { workspaceWrites: { roots: [workspace], approval: "allow" } }),
            ...(capabilities === "shell"
              ? {
                  workspaceProcesses: {
                    roots: [workspace],
                    approval: "allow",
                    ...(options.toolchain?.executablePaths
                      ? { executablePaths: options.toolchain.executablePaths }
                      : {}),
                    ...(options.toolchain?.readOnlyPaths
                      ? { readOnlyPaths: options.toolchain.readOnlyPaths }
                      : {}),
                  },
                }
              : {}),
          };
          runtime = await createRuntime(runtimeOptions);
          if (runtime.plugins.some((plugin) => plugin.state !== "loaded"))
            throw Error("Eval runtime plugin unavailable");
          const current = state;
          unsubscribe = runtime.subscribe((event) => {
            if (event.type === "session.ready") current.sessionId = event.sessionId;
            if (event.type === "run.started") {
              runId = event.runId;
              if (input.signal.aborted) cancel();
            }
            if (event.type === "run.finished" && event.runId === runId) outcome = event.outcome;
            if (event.type === "entry.appended") entries.set(event.entry.id, event.entry);
            if (event.type === "command.rejected") rejected = true;
            if (event.type === "approval.requested")
              void runtime
                ?.send({
                  type: "approval.respond",
                  effectId: event.effectId,
                  digest: event.digest,
                  decision: "deny",
                })
                .catch(() => {});
          });
          input.signal.addEventListener("abort", cancel, { once: true });
          if (state.sessionId)
            await runtime.send({ type: "session.load", sessionId: state.sessionId });
          else await runtime.send({ type: "session.create", workspaceRoot: workspace });
          if (!state.sessionId || rejected) throw Error("Eval session unavailable");
          if (input.signal.aborted)
            return { claimedSuccess: null, modelRequests: 0, outcome: "cancelled" };
          await runtime.send({
            type: "run.start",
            sessionId: state.sessionId,
            input: [{ type: "text", text: input.instruction }],
          });
          await runtime.idle();
          const assistants = [...entries.values()].flatMap((entry) =>
            entry.runId === runId && entry.body.kind === "assistant_message" ? [entry.body] : [],
          );
          const last = assistants.at(-1);
          const result: RunOutcome = outcome ?? { kind: "failed", reason: "No runtime outcome" };
          const complete = !input.signal.aborted && !rejected && result.kind === "completed";
          const text =
            last?.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("") ?? "";
          const usage: Usage[] = assistants.map((body) => body.usage);
          state.instructions.push(input.instruction);
          return {
            claimedSuccess:
              complete &&
              last?.stopReason === "end_turn" &&
              !last.content.some((part) => part.type === "refusal" || part.type === "tool_call")
                ? parseFinalClaim(text)
                : null,
            modelRequests: modelRequests - before,
            usage,
            outcome: input.signal.aborted ? "cancelled" : rejected ? "failed" : result.kind,
          };
        } catch {
          return {
            claimedSuccess: null,
            modelRequests: modelRequests - before,
            outcome: input.signal.aborted ? "cancelled" : "failed",
          };
        } finally {
          input.signal.removeEventListener("abort", cancel);
          unsubscribe();
          try {
            await runtime?.close();
          } finally {
            state.active = false;
          }
        }
      } finally {
        busy = false;
      }
    },
  };
}
