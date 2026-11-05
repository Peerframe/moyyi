import {
  type ActionDigest,
  canonicalizeJson,
  type McpToolDescriptor,
  type Plugin,
  type ToolDefinition,
} from "../../contracts/index.ts";

function tool(descriptor: McpToolDescriptor): ToolDefinition {
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema as ToolDefinition["inputSchema"],
    effect:
      descriptor.effect === "read"
        ? { class: "read", reversibility: "not_applicable", verification: "not_applicable" }
        : { class: "external", reversibility: "none", verification: "none" },
    async prepare(args, context) {
      context.signal.throwIfAborted();
      const preview = canonicalizeJson((args ?? {}) as never);
      return {
        digest: "runtime-computes-action-digest" as ActionDigest,
        summary: `Call ${descriptor.remoteName} on MCP server ${descriptor.server}${descriptor.effect === "read" ? " (owner-declared read-only)" : ""}`,
        preview: preview.length > 4096 ? `${preview.slice(0, 4096)}…` : preview,
        preconditions: [],
        payload: args ?? {},
      };
    },
    async execute(action, context) {
      if (!context.mcp) throw Error("MCP servers are unavailable");
      const result = await context.mcp.call(descriptor.name, action.payload);
      return {
        status: result.isError ? "failed" : "succeeded",
        content: [
          {
            type: "text",
            text: `${result.text || "(no text content)"}${result.truncated ? "\n[output truncated]" : ""}`,
          },
        ],
        evidence: `MCP server ${descriptor.server} reported ${result.isError ? "an error" : "success"}; its output is untrusted and was not independently verified.`,
      };
    },
    async reconcile() {
      return {
        resolved: false,
        reason: "An interrupted MCP call cannot be inferred or repeated automatically.",
      };
    },
  };
}

/** Offers the tools the runtime discovered on owner-configured MCP servers. */
export function createMcpPlugin(descriptors: readonly McpToolDescriptor[]): Plugin {
  const frozen = descriptors.map((descriptor) => structuredClone(descriptor));
  return {
    name: "mcp",
    apiVersion: 1,
    setup(host) {
      for (const descriptor of frozen) host.registerTool(tool(descriptor));
    },
  };
}
