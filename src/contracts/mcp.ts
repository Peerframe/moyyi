import type { ToolContext } from "./tools.ts";

/**
 * A tool an owner-configured MCP server offered, after the runtime bounded and renamed it. The
 * effect class and approval come from the owner's configuration, never from the server's own
 * annotations; the description and schema are untrusted server text.
 */
export interface McpToolDescriptor {
  /** Model-facing name, `mcp__<server>__<tool>`, unique and within the tool-name rule. */
  readonly name: string;
  readonly server: string;
  /** Exact name to send in tools/call. */
  readonly remoteName: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly effect: "read" | "external";
}

export interface McpCallResult {
  readonly isError: boolean;
  /** Text content, already bounded; non-text parts are described, not passed through. */
  readonly text: string;
  readonly truncated: boolean;
}

/** Calls one configured tool; supplied only to tools whose names start with `mcp__`. */
export interface McpToolAccess {
  call(name: string, args: unknown): Promise<McpCallResult>;
}

export interface McpToolAccessFactory {
  create(context: ToolContext, assertAuthorized: () => void): McpToolAccess;
}
