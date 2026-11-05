# ADR 0049: Long-running CLI turns, writable commands and session approvals

- Date: 2026-11-05
- Status: accepted by the owner on 2026-11-05 as the first step toward Claude Code–level use
  (larger budgets, automatic compaction, commands that may change the workspace, and
  "always allow in this session"). All four are opt-in; defaults are unchanged.

## Context

A CLI turn defaulted to 12 model requests and 60 s, the CLI capped requests at 128 and had no
time option, history was compacted only by an explicit `/compact`, granted commands could only
read the workspace, and every gated action needed its own approval. Agents such as Claude Code
work for many steps, run builds and tests that write files, and let the owner stop repeating
the same approval.

## Decision

- **Budgets.** `--max-requests` accepts 1..500 and `--timeout SECONDS` 10..86400. `--long`
  means 200 requests, 3600 s and automatic compaction unless a value is given explicitly. They
  map to the existing `RunLimits` (`maxModelRequests`, `timeoutMs`); the core is unchanged.
- **Automatic compaction (core).** `RuntimeOptions.autoCompact` (`true` = 0.7, or
  `{ thresholdRatio }` in 0.1..0.95) becomes `CoreDeps.autoCompactRatio`. Before an ordinary
  run's first request, the core plans a compaction exactly as `/compact` would. When the history
  it would replace needs at least the ratio of the model's context window, it runs the same
  compaction inside the run: the same prompt, audit sibling, atomic publication and "must
  reduce" check. It uses one request of that run's budget and is skipped when fewer than two
  requests remain. A rejected summary leaves history unchanged and the turn continues; a storage
  failure while publishing fails the turn. Evidence-answer runs never compact automatically.
  Compaction still happens only between turns; one very long turn can still exceed the window.
- **Writable commands.** `--allow-shell-write` grants the existing `read-write` process
  workspace access (the runtime and sandbox already supported it; the CLI did not expose it).
  Commands stay sandboxed, network-denied and approval-gated. Command changes have no snapshots
  or undo, which the grant line and the tool description state.
- **Session approvals (runtime).** `approval.respond` gains an optional `scope: "session"`
  (approve only; the CLI's `/always EFFECT_ID`). After the core accepts the approval, the runtime
  remembers a rule for that run's session: the tool name, or for `shell` the exact command line.
  The runtime's policy wrapper turns the base policy's `ask` into `allow` for matching calls in
  that session. It never changes `deny`, missing grants, revocation or a stricter plugin rule.
  Rules live only in memory, at most 64 per session, and are dropped when the session is loaded
  again or the runtime (or daemon) stops. Nothing is persisted.
- **Background commands.** `shell` accepts `background: true` (time limit up to 3600000 ms,
  default 600000) and returns a handle such as `bg_1` at once. Foreground commands now allow up
  to 600000 ms (was 120000). A runtime-owned registry keeps each background group in the same
  OS sandbox, with a 1 MiB output tail, at most 4 running, and handles bound to the starting
  session. `shell_output` (read class, no approval) returns output since the previous read and
  the state; `shell_stop` (process class, asks like a command) stops the group. A background
  command also stops on its own time limit, on any grant change (policy revision), and when the
  runtime or daemon closes. The core hands the registry only to these two tool names, the same
  way it scopes `read_tool_output`. Both tools are registered only with a process grant.

## Consequences

- A remembered call goes from `intended` to `approved` without `awaiting_approval`, like a
  host-configured `approval: "allow"` grant; the effect journal does not record which rule
  allowed it. The CLI prints the rule when it is created.
- Tool-level rules are broad: remembering `edit` allows every edit in the granted workspace for
  that session. Shell rules are exact so a remembered `npm test` never allows a different
  command line. Prefix rules are not supported.
- A started background command is journaled as a succeeded `process` effect meaning "started";
  its later exit is visible through `shell_output`, not as an effect update. It keeps running
  across turns of its session and is not restored after a crash or restart. Linux uses
  `--die-with-parent`; macOS cleanup after a host SIGKILL is not guaranteed, as for foreground
  commands.
- Automatic compaction sends one extra model request when it triggers; its model-visible effect
  is the existing compaction summary. Its effect on answer quality is not measured yet.
- The daemon passes `scope` through its wire validation; `--connect` cannot set budgets, grants
  or compaction, which remain the daemon's.

## Rejected

- Persisting session approvals: reopening must not restore execution authority.
- Mid-turn automatic compaction: the existing compaction keeps the two latest user turns, so it
  cannot shrink the turn in progress; a different design is needed.
- Command prefix rules: a prefix such as `npm` also allows `npm exec` or `npm install`.
