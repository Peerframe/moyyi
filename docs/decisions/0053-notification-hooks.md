# ADR 0053: Owner notification hooks

- Date: 2026-11-05
- Status: accepted by the owner as part of the Claude Code–level roadmap (extensions: MCP,
  sub-agents, nested instructions, commands, hooks).

## Context

Claude Code runs owner-configured commands on agent events, most often to notify the owner (an
approval is waiting, a task finished) and sometimes to block or rewrite tool calls. moyyi's plugin
observers already cannot block or change a run, and every authority decision belongs to policy,
with every effect journaled. A hook that edits files or approves actions would bypass both.

## Decision

- `RuntimeOptions.hooks`, from trusted host code only: up to 32 entries, each with `on`
  (`approval.requested`, `tool.finished` when an effect reaches a final state, or `run.finished`),
  a command and arguments, an environment added to a minimal `PATH`/`HOME`/`LANG`, an absolute
  `cwd` (default home), optional `tools` for `tool.finished`, and `timeoutMs` (1000..60000,
  default 10000). Configuration is validated before any server or store starts.
- The runtime's `HookRunner` observes every runtime event, including sub-agent events. A
  matching hook receives one JSON line on stdin: `{event, effectId, summary, preview?}` (preview
  cut at 4096 characters), `{event, sessionId, runId, effectId, tool, state}` or
  `{event, sessionId, runId, outcome}`.
- Hooks are **notifications**: they run concurrently with the run (at most 4 at once, 64 queued,
  then skipped with a diagnostic), are never awaited by it, cannot answer approvals or change
  results, and their output never reaches the model. Failures and timeouts become host
  diagnostics (bounded). Their process groups are killed on timeout and when the runtime closes.

## Consequences

- Owners can get desktop notifications, logs or chat messages for approvals and finished work.
- A hook is an owner program like any other: whatever it changes is outside moyyi's effect
  journal, snapshots and undo. Hooks that format or commit files after edits are possible but
  are the owner's responsibility.
- Event payloads can contain file paths, command lines and approval previews; they go only to the
  owner's configured commands.

## Rejected

- Blocking or rewriting hooks (Claude Code's PreToolUse decisions): authority belongs to policy
  rules, which are synchronous, journaled and tested; an external command deciding approvals
  would bypass digest-bound approval.
- Hooks configured by the workspace: no workspace configuration is auto-discovered.
