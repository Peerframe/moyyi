# Sub-agents

`subagentPlugin` registers `agent`, which delegates a self-contained, read-only investigation to
a sub-agent in a child session. The runtime's `SubagentRunner` creates the child session in the
same store and workspace, runs it on a second core whose tools are only the read-class tools
(never `agent`), and returns the sub-agent's final answer. Enable it with `RuntimeOptions.subagents`
or the CLI's `--subagents`. Decision: [ADR 0051](../../../docs/decisions/0051-read-only-subagents.md).

## Usage and implementation

Arguments: `description` (1–120 characters, shown in the approval summary and the child's brief)
and `prompt` (1–16000 characters). The effect class is `read`: the sub-agent cannot change
files, run commands or use the web, so no workspace effect is journaled for the call itself;
every tool call the sub-agent makes is journaled in its own session. The result is
`{"outcome", "reason"?, "subagentSession", "report"}`; any outcome other than `completed` is a
failed tool result. The plugin imports only the contracts and accepts no configuration.

## Model experience

- **What the model sees**: the `agent` tool description and schema in
  [docs/tool-catalog.md](../../../docs/tool-catalog.md). The sub-agent sees its brief wrapped as
  `Sub-agent task from the main agent: <description>` followed by the prompt and a fixed paragraph
  asking for a concise, self-contained report with paths, evidence and unverified points.
- **Token cost**: the tool adds a fixed schema cost per request. Each sub-agent uses up to its own
  request limit (default 12) with a fresh context; only its final report (bounded by the tool
  output limit) enters the main context, which is the point of delegating.
- **Prompt-cache effect**: the main tool list is fixed while the runtime runs; sub-agent requests
  form their own prefixes.

## Known limits

- Read-only by design; writes, commands and web access stay with the main agent.
- A sub-agent's report is model output; the main agent should verify claims it relies on.
- Recordings of parallel sub-agents interleave, so replay of such runs is not deterministic.
