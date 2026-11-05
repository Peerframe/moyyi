# MCP servers

moyyi can offer the tools of local MCP servers to the model. Servers are configured only in your
trusted host module (`--host FILE`), never by a project or by the model. Decision and security
rationale: [ADR 0050](decisions/0050-mcp-client.md).

## Configure

Add `mcp` to the `RuntimeOptions` your host module exports:

```ts
export default {
  model: { provider: "deepseek", model: "deepseek-flash" },
  // ...your existing settings...
  mcp: {
    servers: [
      {
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: readTokenFromKeychain() },
        tools: ["search_issues", "get_issue", "create_issue"],
        readOnlyTools: ["search_issues", "get_issue"],
        approval: "ask",
      },
    ],
  },
};
```

| Field | Meaning |
|---|---|
| `name` | Lowercase, `^[a-z][a-z0-9-]{0,23}$`; tools appear as `mcp__<name>__<tool>` |
| `command`, `args` | The program to start; a bare name is looked up on `PATH` |
| `env` | Added to a minimal `PATH`, `HOME` and `LANG`; nothing else from your shell is passed |
| `cwd` | Absolute working directory; default is your home directory |
| `tools` | Optional allow-list of the server's tool names; others are not offered |
| `readOnlyTools` | Tools you declare read-only: they run without approval under the read grant |
| `approval` | `ask` (default) or `allow` for every other tool of this server |
| `timeoutMs` | Per call, 1000..600000 (default 60000) |

At startup the CLI prints one line per server, for example
`mcp | github: 3 tool(s); protocol 2025-06-18`, or why it is unavailable. A server that fails
does not stop the others or the session.

## What to expect

- Servers start with the CLI or daemon and stop when it exits. They run as ordinary programs
  with the environment you give them: **they are not sandboxed**. Only configure servers you
  would run yourself.
- Whether a tool asks before running comes only from your configuration. Server hints such as
  "read-only" are ignored. `/always` can stop asking for one tool for the rest of a session.
- Tool descriptions and results come from the server and are shown to the model as untrusted
  text. A malicious server can still try to mislead the model; approvals limit what it can do.
- Results are text; images and audio are described, not passed on. Output is cut at the tool
  output limit.
- Each offered tool costs context on every request. Prefer `tools` allow-lists for large servers.

## Limits

Only the stdio transport and MCP tools are supported: no HTTP servers, resources, prompts,
sampling, roots or elicitation. Tool lists are read once at startup. At most 16 servers and
128 tools per server; messages up to 4 MiB. The desktop app does not configure MCP servers yet.
