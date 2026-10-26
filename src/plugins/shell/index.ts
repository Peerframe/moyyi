import {
  type ActionDigest,
  canonicalizeJson,
  type Plugin,
  type ProcessRequest,
  type ToolDefinition,
} from "../../contracts/index.ts";

export const shellTool: ToolDefinition = {
  name: "shell",
  description:
    "Bounded /bin/sh in granted workspace with OS isolation, clean env; no network/sensitive paths. No write snapshots/rollback. Cancel/interrupt may leave changes: verify before retrying. No persistent/background terminal.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1, maxLength: 16384 },
      cwd: { type: "string", minLength: 1, maxLength: 4096 },
      timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
    },
    required: ["command"],
    additionalProperties: false,
  },
  effect: { class: "process", reversibility: "none", verification: "none" },
  async prepare(args, context) {
    if (!context.processes) throw Error("Sandboxed process capability is unavailable");
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw Error("Invalid shell arguments");
    const input = args as Partial<ProcessRequest>;
    const process = await context.processes.prepare({
      command: input.command as string,
      cwd: input.cwd ?? ".",
      timeoutMs: input.timeoutMs ?? 30000,
    });
    return {
      digest: "executor-binds-process" as ActionDigest,
      summary: `Run command in ${process.cwd} (${process.backend}, network denied)`,
      preview: canonicalizeJson({ ...process, network: "denied", rollback: "unavailable" }),
      preconditions: [{ kind: "path_resolves_within", path: process.cwd, root: "." }],
      payload: process,
    };
  },
  async execute(_action, context) {
    if (!context.processes) throw Error("Sandboxed process capability is unavailable");
    const result = await context.processes.run();
    if (result.termination !== "exited")
      throw Error(`Command ${result.termination}; changes may be partial. ${result.output}`);
    return {
      status: result.exitCode === 0 ? "succeeded" : "failed",
      content: [{ type: "text", text: canonicalizeJson(result) }],
      evidence: `Command exited with code ${result.exitCode}; this does not prove its task succeeded or undo its effects.`,
    };
  },
  async reconcile() {
    return {
      resolved: false,
      reason:
        "Interrupted commands cannot be inferred or replayed; inspect the workspace before retrying.",
    };
  },
};

export const shellPlugin: Plugin = {
  name: "shell",
  apiVersion: 1,
  setup(host) {
    host.registerTool(shellTool);
  },
};
