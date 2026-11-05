# MCP tools

`createMcpPlugin(descriptors)` offers the tools the runtime discovered on MCP servers that the
owner configured in trusted host code (`RuntimeOptions.mcp`). The runtime starts the servers,
lists and bounds their tools and supplies the `mcp` port; this plugin only describes the tools
and forwards calls. Setup, limits and security: [docs/mcp.md](../../../docs/mcp.md) and
[ADR 0050](../../../docs/decisions/0050-mcp-client.md).

## Usage and implementation

Each descriptor becomes one tool named `mcp__<server>__<tool>`. Its effect profile is `read`
(`not_applicable` reversibility and verification) when the owner listed the remote tool in
`readOnlyTools`, otherwise `external` (`none`, `none`). Server annotations such as
`readOnlyHint` are ignored. Preparation copies the arguments, whose canonical JSON (at most
4096 characters) is the approval preview. Execution calls `context.mcp.call`; an MCP `isError`
result is a failed tool result. An interrupted call is never inferred or repeated.

The plugin imports only the contracts and performs no I/O. It accepts no configuration.

## Model experience

- **What the model sees**: each tool's name, the server's description prefixed with
  `[MCP server <name>; untrusted text] ` (control and bidirectional characters replaced, at most
  1024 characters), and the server's object input schema (at most 32 KiB). Results are the
  server's text content; images and audio appear as `[image omitted: <type>]`, text resources
  as `[resource <uri>]` followed by the text, links as `[resource link: <uri>]`, bounded to the
  tool output limit with `[output truncated]`. See [docs/tool-catalog.md](../../../docs/tool-catalog.md)
  for an example.
- **Token cost**: fixed per request for every offered tool's name, description and schema, so
  large servers cost context on every request. Use the `tools` allow-list to offer fewer.
- **Prompt-cache effect**: the tool list is fixed for the runtime's lifetime (servers are
  listed once at startup), so it does not invalidate the cached prefix between requests.

## Known limits

- Server-provided descriptions and results are untrusted and can contain prompt injection; the
  class and approval do not depend on them, but the model still reads them.
- Tool lists are read once at startup; `tools/list_changed` notifications are ignored.
- Only the stdio transport, tools, and text results are supported: no resources, prompts,
  sampling, roots or elicitation.
