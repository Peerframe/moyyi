# ADR 0050: MCP client for owner-configured stdio servers

- Date: 2026-11-05
- Status: accepted by the owner as part of the Claude Code–level roadmap ("extensions": MCP first,
  then sub-agents). Implements the `mcp` plugin planned in [ADR 0005](0005-plugins.md).

## Context

Claude Code, Codex and goose reach most outside systems (issue trackers, docs, databases)
through MCP servers. moyyi's architecture already reserved an `mcp` plugin: untrusted
capabilities run out of process behind a plugin that assigns their effect profiles (threat T3:
a tool's self-description can lie). Plugins cannot start processes, so the transport must be a
runtime capability.

## Decision

- **Configuration** only from trusted host code: `RuntimeOptions.mcp.servers`. Each server has a
  name (`^[a-z][a-z0-9-]{0,23}$`), a command and arguments, an explicit environment added to a
  minimal `PATH`/`HOME`/`LANG`, an absolute cwd (default: home), an optional `tools` allow-list,
  `readOnlyTools`, `approval` (`ask` default, or `allow`) and a per-call `timeoutMs`
  (1000..600000, default 60000). No project file, environment variable or model output adds a
  server. At most 16 servers and 128 tools per server.
- **Transport** (`src/runtime/mcp`): stdio, newline-delimited JSON-RPC 2.0, protocol versions
  2025-06-18, 2025-03-26 and 2024-11-05. `initialize`, `notifications/initialized`, paginated
  `tools/list` and `tools/call`; cancellation sends `notifications/cancelled`. Server requests
  other than `ping` get "method not found": no roots, sampling or elicitation. Messages are at
  most 4 MiB; stderr is kept as a 4 KiB diagnostic tail. Servers start when the runtime is
  created and their process groups stop when it closes or if creation fails.
- **Servers are not sandboxed.** They are owner-chosen local programs, trusted like the host
  module that configures them. This differs from model-requested commands, which always run in
  the OS sandbox.
- **Tools** (`src/plugins/mcp`): `mcp__<server>__<tool>`, lowercased and limited to the tool-name
  rule (long or colliding names get a hash suffix). Descriptions are prefixed
  `[MCP server <name>; untrusted text]`, stripped of control and bidirectional characters and cut
  at 1024 characters. Only object input schemas up to 32 KiB are offered; arguments are validated
  against them as for every tool. Results keep text, describe other content types, and are cut at
  the tool output limit on a UTF-8 boundary. `isError` is a failed result.
- **Authority** (`McpPolicy`, outermost runtime policy): a tool the owner listed in
  `readOnlyTools` is a `read` effect and still needs the ordinary read grant; every other tool is
  an `external` effect with the server's `approval`. Server annotations are ignored. Unknown
  `mcp__` names are denied. The core supplies the `mcp` port only to `mcp__` tools in the execute
  phase, as it does for other name-scoped ports.

## Consequences

- MCP tools work in the CLI (through `--host`), the daemon and programmatic hosts. The desktop app
  does not configure servers yet.
- Every offered tool costs context on every request; allow-lists keep that bounded.
- Tool descriptions and results are untrusted text the model reads. Approval and effect classes
  limit what follows from a prompt injection, not what the model believes.
- An interrupted external call follows the usual unknown-effect handling; nothing is repeated
  automatically.

## Rejected

- Sandboxing servers with the command sandbox: most servers need network access and credentials
  by design; a sandbox that allows both would only look safe.
- Trusting `readOnlyHint` or `destructiveHint` annotations: they are self-descriptions (T3).
- HTTP/SSE transports, resources, prompts and `tools/list_changed` in this first version.
