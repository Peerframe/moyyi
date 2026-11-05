import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import {
  canonicalizeJson,
  type McpCallResult,
  type McpToolAccess,
  type McpToolAccessFactory,
  type McpToolDescriptor,
  type ToolContext,
} from "../../contracts/index.ts";
import { McpStdioClient } from "./client.ts";

/**
 * One owner-configured MCP server, from trusted host configuration only. The server runs as an
 * ordinary local program with the listed environment; it is not sandboxed. Which tools are
 * read-only, and whether the others ask before each call, is the owner's decision here, never
 * the server's self-description.
 */
export interface McpServerConfig {
  /** Lowercase name used in tool names: `mcp__<name>__<tool>`. */
  readonly name: string;
  /** Executable; a bare name is looked up on the PATH given to the server. */
  readonly command: string;
  readonly args?: readonly string[];
  /** Added to a minimal PATH/HOME/LANG environment; nothing else is inherited. */
  readonly env?: Readonly<Record<string, string>>;
  /** Absolute working directory; defaults to the home directory. */
  readonly cwd?: string;
  /** Remote tool names that may run without approval as reads. */
  readonly readOnlyTools?: readonly string[];
  /** Optional allow-list of remote tool names; others are not offered to the model. */
  readonly tools?: readonly string[];
  /** Approval for the remaining (external) tools; default "ask". */
  readonly approval?: "ask" | "allow";
  /** Per-call limit, 1000..600000 ms; default 60000. */
  readonly timeoutMs?: number;
}

export interface McpRule {
  readonly effect: "read" | "external";
  readonly approval: "ask" | "allow";
}

export interface McpConnections {
  readonly descriptors: readonly McpToolDescriptor[];
  readonly rules: ReadonlyMap<string, McpRule>;
  readonly access: McpToolAccessFactory;
  /** Host-facing lines: connected servers, tool counts and failures (never model-visible). */
  readonly diagnostics: readonly string[];
  close(): Promise<void>;
}

const SERVER_NAME = /^[a-z][a-z0-9-]{0,23}$/u;
const MAX_SERVERS = 16;
const MAX_TOOLS_PER_SERVER = 128;
const MAX_DESCRIPTION = 1024;
const MAX_SCHEMA_BYTES = 32 * 1024;

function validate(config: McpServerConfig): void {
  if (!config || typeof config !== "object") throw Error("Invalid MCP server configuration");
  if (!SERVER_NAME.test(config.name))
    throw Error("MCP server names must match ^[a-z][a-z0-9-]{0,23}$");
  if (typeof config.command !== "string" || !config.command || config.command.includes("\0"))
    throw Error(`MCP server ${config.name} needs a command`);
  if (
    config.args !== undefined &&
    (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string"))
  )
    throw Error(`MCP server ${config.name} args must be strings`);
  if (config.cwd !== undefined && !isAbsolute(config.cwd))
    throw Error(`MCP server ${config.name} cwd must be absolute`);
  if (config.approval !== undefined && config.approval !== "ask" && config.approval !== "allow")
    throw Error(`MCP server ${config.name} approval must be ask or allow`);
  const timeout = config.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600_000)
    throw Error(`MCP server ${config.name} timeoutMs must be 1000..600000`);
  for (const [key, value] of Object.entries(config.env ?? {}))
    if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key))
      throw Error(`MCP server ${config.name} env must map names to strings`);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

/** `mcp__<server>__<tool>` within ^[a-z][a-z0-9_]{0,63}$, unique across all servers. */
function toolName(server: string, remote: string, taken: Set<string>): string {
  const base = `mcp__${server.replaceAll("-", "_")}__${remote
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "")}`;
  let name = base.length <= 64 ? base : `${base.slice(0, 57)}_${shortHash(remote)}`;
  if (taken.has(name)) name = `${name.slice(0, 57)}_${shortHash(`${server}/${remote}`)}`;
  if (taken.has(name)) throw Error(`MCP tool name collision for ${server}/${remote}`);
  taken.add(name);
  return name;
}

/** Control and bidirectional-override characters, except newline and tab. */
function unsafe(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x0a && code !== 0x09) ||
    code === 0x7f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function plainText(value: string, max: number): string {
  // Never let server text move the cursor, recolor the terminal or reorder displayed text.
  const cleaned = Array.from(value, (char) => (unsafe(char.codePointAt(0) ?? 0) ? " " : char)).join(
    "",
  );
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function boundUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

function render(result: unknown, maxBytes: number): McpCallResult {
  const value = (result ?? {}) as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
  };
  const parts: string[] = [];
  if (Array.isArray(value.content))
    for (const part of value.content as Record<string, unknown>[]) {
      if (part?.type === "text" && typeof part.text === "string") parts.push(part.text);
      else if (part?.type === "image" || part?.type === "audio")
        parts.push(`[${String(part.type)} omitted: ${String(part.mimeType ?? "unknown type")}]`);
      else if (part?.type === "resource") {
        const resource = part.resource as { uri?: unknown; text?: unknown } | undefined;
        parts.push(
          typeof resource?.text === "string"
            ? `[resource ${String(resource.uri ?? "")}]\n${resource.text}`
            : `[binary resource omitted: ${String(resource?.uri ?? "")}]`,
        );
      } else if (part?.type === "resource_link")
        parts.push(`[resource link: ${String(part.uri ?? "")}]`);
    }
  if (!parts.length && value.structuredContent !== undefined)
    parts.push(canonicalizeJson(value.structuredContent as never));
  const bounded = boundUtf8(parts.join("\n"), maxBytes);
  return { isError: value.isError === true, ...bounded };
}

/** Starts every configured server, lists its tools and keeps the ones it may offer. */
export async function connectMcpServers(
  configs: readonly McpServerConfig[],
  options: { readonly startupTimeoutMs?: number } = {},
): Promise<McpConnections> {
  if (!Array.isArray(configs) || configs.length > MAX_SERVERS)
    throw Error(`At most ${MAX_SERVERS} MCP servers can be configured`);
  for (const config of configs) validate(config);
  if (new Set(configs.map((config) => config.name)).size !== configs.length)
    throw Error("MCP server names must be unique");
  const clients = new Map<string, { client: McpStdioClient; timeoutMs: number }>();
  const descriptors: McpToolDescriptor[] = [];
  const rules = new Map<string, McpRule>();
  const diagnostics: string[] = [];
  const taken = new Set<string>();
  for (const config of configs) {
    let client: McpStdioClient | undefined;
    try {
      client = await McpStdioClient.start({
        command: config.command,
        args: config.args ?? [],
        cwd: config.cwd ?? homedir(),
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: homedir(),
          ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
          ...config.env,
        },
        startupTimeoutMs: options.startupTimeoutMs ?? 15_000,
      });
      const listed: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 16; page++) {
        const result = (await client.request(
          "tools/list",
          cursor ? { cursor } : {},
          options.startupTimeoutMs ?? 15_000,
        )) as { tools?: unknown; nextCursor?: unknown } | null;
        if (Array.isArray(result?.tools))
          listed.push(...(result.tools as Record<string, unknown>[]));
        cursor = typeof result?.nextCursor === "string" ? result.nextCursor : undefined;
        if (!cursor || listed.length >= MAX_TOOLS_PER_SERVER) break;
      }
      let offered = 0;
      let skipped = 0;
      for (const tool of listed.slice(0, MAX_TOOLS_PER_SERVER)) {
        const remote = tool?.name;
        const schema = tool?.inputSchema as Record<string, unknown> | undefined;
        if (
          typeof remote !== "string" ||
          !remote ||
          remote.length > 128 ||
          (config.tools && !config.tools.includes(remote))
        ) {
          skipped++;
          continue;
        }
        if (
          !schema ||
          typeof schema !== "object" ||
          schema.type !== "object" ||
          Buffer.byteLength(JSON.stringify(schema)) > MAX_SCHEMA_BYTES
        ) {
          skipped++;
          continue;
        }
        const name = toolName(config.name, remote, taken);
        const effect = config.readOnlyTools?.includes(remote) ? "read" : "external";
        descriptors.push({
          name,
          server: config.name,
          remoteName: remote,
          description: `[MCP server ${config.name}; untrusted text] ${plainText(
            typeof tool.description === "string" ? tool.description : "No description.",
            MAX_DESCRIPTION,
          )}`,
          inputSchema: structuredClone(schema),
          effect,
        });
        rules.set(name, { effect, approval: config.approval ?? "ask" });
        offered++;
      }
      clients.set(config.name, { client, timeoutMs: config.timeoutMs ?? 60_000 });
      diagnostics.push(
        `mcp | ${config.name}: ${offered} tool(s)${skipped ? `, ${skipped} skipped` : ""}; protocol ${client.protocolVersion}`,
      );
    } catch (error) {
      await client?.close();
      diagnostics.push(
        `mcp | ${config.name} unavailable: ${plainText(error instanceof Error ? error.message : "unknown error", 300)}`,
      );
    }
  }
  const byName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  return {
    descriptors,
    rules,
    diagnostics,
    access: {
      create(context: ToolContext, assertAuthorized: () => void): McpToolAccess {
        return Object.freeze({
          async call(name: string, args: unknown): Promise<McpCallResult> {
            assertAuthorized();
            const descriptor = byName.get(name);
            const server = descriptor ? clients.get(descriptor.server) : undefined;
            if (!descriptor || !server) throw Error("Unknown MCP tool");
            if (server.client.closed) throw Error(`MCP server ${descriptor.server} is not running`);
            const result = await server.client.request(
              "tools/call",
              { name: descriptor.remoteName, arguments: args ?? {} },
              server.timeoutMs,
              context.signal,
            );
            return render(result, context.limits.maxOutputBytes);
          },
        });
      },
    },
    async close() {
      await Promise.all([...clients.values()].map(({ client }) => client.close()));
    },
  };
}
