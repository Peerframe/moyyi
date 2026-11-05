import {
  type ActionDigest,
  type BackgroundProcessView,
  canonicalizeJson,
  type Plugin,
  type ProcessRequest,
  type ToolDefinition,
} from "../../contracts/index.ts";

export const shellTool: ToolDefinition = {
  name: "shell",
  description:
    "Bounded commands in granted workspace with OS isolation, clean env; no network/sensitive paths. No write snapshots/rollback. Cancel/interrupt may leave changes: verify before retrying. Foreground timeoutMs up to 600000. For servers, watchers or long builds set background:true (timeoutMs up to 3600000): the call returns a handle at once; read it with shell_output and end it with shell_stop.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1, maxLength: 16384 },
      cwd: { type: "string", minLength: 1, maxLength: 4096 },
      timeoutMs: { type: "integer", minimum: 1, maximum: 3600000 },
      background: { type: "boolean" },
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
    const background = input.background === true;
    const process = await context.processes.prepare({
      command: input.command as string,
      cwd: input.cwd ?? ".",
      timeoutMs: input.timeoutMs ?? (background ? 600000 : 30000),
      ...(background ? { background: true } : {}),
    });
    return {
      digest: "executor-binds-process" as ActionDigest,
      summary: `${background ? "Start background command" : "Run command"} in ${process.cwd} (${process.workspaceAccess}, ${process.backend}, network denied${background ? `, stops after ${process.timeoutMs} ms` : ""})`,
      preview: canonicalizeJson({ ...process, network: "denied", rollback: "unavailable" }),
      preconditions: [{ kind: "path_resolves_within", path: process.cwd, root: "." }],
      payload: process,
    };
  },
  async execute(_action, context) {
    if (!context.processes) throw Error("Sandboxed process capability is unavailable");
    const result = await context.processes.run();
    if (result.termination === "background")
      return {
        status: "succeeded",
        content: [
          {
            type: "text",
            text: canonicalizeJson({
              termination: "background",
              handle: result.handle ?? null,
              next: "Use shell_output with this handle to read output; shell_stop ends it.",
            }),
          },
        ],
        evidence: `Started in the background as ${result.handle}; it may still be running and changing files.`,
      };
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

const handleSchema = { type: "string", pattern: "^bg_[0-9]{1,6}$" } as const;

function view(value: BackgroundProcessView): string {
  return canonicalizeJson({ ...value });
}

export const shellOutputTool: ToolDefinition = {
  name: "shell_output",
  description:
    "Read new output and the state of a background command started by shell in this session. Returns only output produced since the previous read (maxBytes 256-32768, default 8192); more:true means unread output remains. state: running, exited, stopped, timeout, revoked or unknown.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      handle: handleSchema,
      maxBytes: { type: "integer", minimum: 256, maximum: 32768 },
    },
    required: ["handle"],
  },
  effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
  async prepare(args, context) {
    context.signal.throwIfAborted();
    return {
      digest: "runtime-computes-action-digest" as ActionDigest,
      summary: "Read background command output from this session",
      preconditions: [],
      payload: args,
    };
  },
  async execute(action, context) {
    if (!context.backgroundProcesses) throw Error("Background commands are unavailable");
    const args = action.payload as { handle: string; maxBytes?: number };
    const result = await context.backgroundProcesses.output(
      args.handle,
      Math.min(args.maxBytes ?? 8192, context.limits.maxOutputBytes),
    );
    return { status: "succeeded", content: [{ type: "text", text: view(result) }] };
  },
};

export const shellStopTool: ToolDefinition = {
  name: "shell_stop",
  description:
    "Stop a background command started by shell in this session, including the processes it started, and return its remaining output and final state. Changes it already made stay.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { handle: handleSchema },
    required: ["handle"],
  },
  effect: { class: "process", reversibility: "none", verification: "none" },
  async prepare(args, context) {
    context.signal.throwIfAborted();
    const handle = (args as { handle: string }).handle;
    return {
      digest: "executor-binds-process" as ActionDigest,
      summary: `Stop background command ${handle}`,
      preconditions: [],
      payload: { handle },
    };
  },
  async execute(action, context) {
    if (!context.backgroundProcesses) throw Error("Background commands are unavailable");
    const result = await context.backgroundProcesses.stop(
      (action.payload as { handle: string }).handle,
    );
    return {
      status: "succeeded",
      content: [{ type: "text", text: view(result) }],
      evidence: `Background command ${result.handle} is ${result.state}.`,
    };
  },
  async reconcile() {
    return {
      resolved: false,
      reason: "An interrupted stop cannot be inferred; background commands end with the runtime.",
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

export interface ShellConfiguration {
  readonly workspaceAccess: "unconfigured" | "read-only" | "read-write";
  readonly interpreter: "sh" | "zsh-sh";
  /** Host-selected names, not paths or a scan of the owner's environment. */
  readonly executableNames: readonly string[];
}

/** Describe the same startup configuration used by the runtime; this grants no authority. */
export function createShellPlugin(configuration: ShellConfiguration): Plugin {
  if (!["unconfigured", "read-only", "read-write"].includes(configuration.workspaceAccess))
    throw Error("Invalid shell workspace description");
  if (!["sh", "zsh-sh"].includes(configuration.interpreter))
    throw Error("Invalid shell interpreter description");
  if (!Array.isArray(configuration.executableNames)) throw Error("Invalid shell executable names");
  // Keep arbitrary host path text out of model guidance and bound this metadata independently.
  const selected = [...new Set(configuration.executableNames)];
  const names = selected
    .filter((name) => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(name))
    .sort()
    .slice(0, 16);
  const omitted = names.length !== selected.length;
  const launcher =
    configuration.interpreter === "zsh-sh"
      ? "macOS launcher is /bin/zsh in sh emulation"
      : "Linux launcher is /bin/sh";
  // Unavailable tools must not spend a small model's context on unusable environment details.
  const description =
    configuration.workspaceAccess === "unconfigured"
      ? `Command execution is unconfigured and unavailable; use permitted file tools. ${launcher}. Policy still applies; no command authority is granted.`
      : [
          shellTool.description,
          `Configured workspace access: ${configuration.workspaceAccess}. ${configuration.workspaceAccess === "read-only" ? "Use authorized file tools for changes." : "Command changes have no snapshots."} Private temporary files: $TMPDIR.`,
          `${launcher}; no startup files. Use portable syntax, not Bash-specific features.`,
          `Host-selected additional executable names on PATH: ${names.length ? names.join(", ") : "none"}.${omitted ? " Some names are omitted." : ""} Prefer selected interpreters for checks. Other interpreters/packages are not implied; do not install them or bypass isolation.`,
          "This is configuration information, not permission or a successful launch check. Grants, policy, approval and revocation still apply.",
        ].join(" ");
  return {
    ...shellPlugin,
    setup(host) {
      host.registerTool({ ...shellTool, description });
      // Unavailable tools must not spend context; background control needs a process grant.
      if (configuration.workspaceAccess !== "unconfigured") {
        host.registerTool(shellOutputTool);
        host.registerTool(shellStopTool);
      }
    },
  };
}
