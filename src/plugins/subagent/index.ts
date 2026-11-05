import {
  type ActionDigest,
  canonicalizeJson,
  type Plugin,
  type ToolDefinition,
} from "../../contracts/index.ts";

export const agentTool: ToolDefinition = {
  name: "agent",
  description:
    "Delegate a self-contained, read-only investigation to a sub-agent with a fresh context, e.g. searching a large codebase or reading many files to answer one question. It can read, list and search the workspace and use read-only MCP tools; it cannot edit, run commands, use the web or start sub-agents. Put a complete brief in prompt: the goal, where to look and what to report. Calls in the same response run in parallel. Returns the sub-agent's final report and its session id; it uses its own model requests.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      description: { type: "string", minLength: 1, maxLength: 120 },
      prompt: { type: "string", minLength: 1, maxLength: 16000 },
    },
    required: ["description", "prompt"],
  },
  effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
  async prepare(args, context) {
    context.signal.throwIfAborted();
    const input = args as { description: string; prompt: string };
    return {
      digest: "runtime-computes-action-digest" as ActionDigest,
      summary: `Start read-only sub-agent: ${input.description}`,
      preconditions: [],
      payload: { description: input.description, prompt: input.prompt },
    };
  },
  async execute(action, context) {
    if (!context.subagents) throw Error("Sub-agents are unavailable");
    const result = await context.subagents.run(
      action.payload as { description: string; prompt: string },
    );
    return {
      status: result.outcome === "completed" ? "succeeded" : "failed",
      content: [
        {
          type: "text",
          text: canonicalizeJson({
            outcome: result.outcome,
            ...(result.reason ? { reason: result.reason } : {}),
            subagentSession: result.sessionId,
            report: `${result.text || "(no answer text)"}${result.truncated ? "\n[report truncated]" : ""}`,
          }),
        },
      ],
      evidence: `Sub-agent session ${result.sessionId} ended ${result.outcome}; its report is model output, not verified.`,
    };
  },
};

/** Offers `agent` when the host enables read-only sub-agents. */
export const subagentPlugin: Plugin = {
  name: "subagent",
  apiVersion: 1,
  setup(host) {
    if (host.config !== undefined) throw Error("subagent does not accept configuration");
    host.registerTool(agentTool);
  },
};
