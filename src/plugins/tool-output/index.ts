import type { ActionDigest, Plugin } from "../../contracts/index.ts";

export const toolOutputPlugin: Plugin = {
  name: "tool-output",
  apiVersion: 1,
  setup(host) {
    if (host.config !== undefined) throw Error("tool-output does not accept configuration");
    host.registerTool({
      name: "read_tool_output",
      description:
        "Retrieve a byte range from a tool-output handle returned in this session. Use it to inspect omitted evidence before drawing conclusions. offset starts at 0; length is 1–8192 UTF-8 bytes. Follow nextOffset for continuation. Handles grant no access to other sessions or files.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          handle: { type: "string", pattern: "^tool-output:[a-f0-9]{64}$" },
          offset: { type: "integer", minimum: 0, maximum: 67108864 },
          length: { type: "integer", minimum: 1, maximum: 8192 },
        },
        required: ["handle", "offset", "length"],
      },
      effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
      async prepare(args, context) {
        context.signal.throwIfAborted();
        return {
          digest: "runtime-computes-action-digest" as ActionDigest,
          summary: "Read recorded output from this session",
          preconditions: [],
          payload: args,
        };
      },
      async execute(action, context) {
        context.signal.throwIfAborted();
        if (!context.toolOutputs) throw Error("Recorded tool output capability is unavailable");
        const args = action.payload as { handle: string; offset: number; length: number };
        const text = await context.toolOutputs.read(args.handle, args.offset, args.length);
        return { status: "succeeded", content: [{ type: "text", text }] };
      },
    });
  },
};
