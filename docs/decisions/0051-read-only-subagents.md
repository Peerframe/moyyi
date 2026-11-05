# ADR 0051: Read-only sub-agents in child sessions

- Date: 2026-11-05
- Status: accepted by the owner as part of the Claude Code–level roadmap (extensions: MCP, then
  sub-agents). Resolves the open "sub-agents" decision in [architecture](../architecture.md).

## Context

Claude Code delegates broad searches and investigations to sub-agents with a fresh context, so
the main conversation receives a short report instead of every file read. The architecture said
sub-agents would most likely be a tool that starts a child session. Writes and commands hold a
workspace lease per run, and overlapping parent/child leases are rejected, so a writing
sub-agent in the same workspace would conflict with its parent.

## Decision

- **Tool**: `agent` (`subagent` plugin, opt-in through `RuntimeOptions.subagents` or the CLI's
  `--subagents`), with `description` and `prompt`. Its effect class is `read`.
- **Child session and core**: the runtime's `SubagentRunner` creates a normal session in the same
  store and workspace and runs the brief on a second `AgentCore`. That core shares the store,
  model client (and recorder), context builder, policy and ports, but its tools are only the
  read-class tools, excluding `agent`. A sub-agent therefore cannot write, run commands, use the
  web or start sub-agents; it can use read-only MCP tools. Evidence-answer mode is not used for
  children; automatic compaction applies as configured.
- **Budgets**: per sub-agent `maxRequests` (default 12, 2..200) and `timeoutMs` (default 300000,
  10000..3600000); `maxConcurrent` (default 4, 1..8) across the runtime and `maxPerRun` (default
  16, 1..64) per parent run. The general read-tool deadline does not apply to `agent`; the
  child's own time limit does (and, in the same change, to `mcp__` tools, which have their own).
- **Lifecycle**: cancelling the parent run cancels its sub-agents. The parent receives
  `{outcome, reason?, subagentSession, report}`; only `completed` is a succeeded result.
- **Events**: child events reach clients except `session.ready`, history pages and rejections,
  so no client switches into a child session. Approvals stay visible; the runtime sends an
  `approval.respond` for a child's effect to the child core. The daemon shows an approval from a
  session nobody views to every client.
- **Recording**: the child session is ordinary recorded history; its id appears in the parent's
  tool result. No persisted format changes.

## Consequences

- Investigations no longer fill the main context; each sub-agent costs its own model requests,
  bounded by the limits above.
- A sub-agent's report is model output that the main agent should verify before relying on it.
- Parallel sub-agents interleave recorded requests, so replaying such runs is not deterministic.
- Removing a parent session does not remove its child sessions; they are listed like any other.

## Rejected

- Writing sub-agents: they would need lease hand-off between parent and child runs, and a second
  agent changing files concurrently is harder to review. Writes stay with the main agent.
- Recursive sub-agents: unbounded fan-out of paid requests.
- A parent/child field in the session schema: the child id in the recorded tool result links
  them without a persisted-format change.
