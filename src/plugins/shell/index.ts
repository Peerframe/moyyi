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
    "Bounded commands in granted workspace with OS isolation, clean env; no network/sensitive paths. No write snapshots/rollback. Cancel/interrupt may leave changes: verify before retrying. No persistent/background terminal.",
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
      summary: `Run command in ${process.cwd} (${process.workspaceAccess}, ${process.backend}, network denied)`,
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
    },
  };
}
