# ADR 0054: Plan mode

- Date: 2026-11-05
- Status: accepted by the owner as part of the Claude Code–level roadmap (CLI ergonomics).

## Context

Claude Code's plan mode lets the owner ask for an investigation and a plan before anything
changes, then approve the plan. In moyyi, approvals already gate each change, but a model can
still propose and run changes in the same turn, and `/always` rules or `allow` grants can let some
of them through without asking.

## Decision

- New client command `session.mode` with `mode: "plan" | "default"` (wire-validated for the
  daemon). The runtime keeps plan-mode sessions in memory; `session.load` and runtime close reset
  them to `default`. Nothing is persisted.
- While a session is in plan mode, the runtime's policy wrapper denies every non-read effect of
  that session's runs at execution, before any approval prompt and before `/always` rules or
  `allow` grants apply, with the reason "Plan mode: changes, commands and external calls are
  disabled until the owner approves the plan." Reads, read-only MCP tools and sub-agents work.
- CLI: `/plan` (or `--plan`) enters plan mode; each message then carries a fixed `[Plan mode]`
  paragraph asking for a read-only investigation and a step-by-step plan. `/execute` leaves plan
  mode and sends a fixed approval message; `/plan off` leaves without a message. Changing modes is
  refused while a run is active.
- Desktop: the composer's **计划模式** toggle sends `session.mode` through the conversation
  feature, which appends the same paragraph (shared from `src/contracts/plan-mode.ts`) to each
  message. **按计划执行** is a host command, not renderer text: after the start checks pass, the
  host turns plan mode off and sends the same fixed approval message. Opening, creating or
  removing a session resets the toggle, matching the runtime reset on `session.load`. Changing
  permissions, site access or settings rebuilds the runtime; the host then sends `session.mode`
  again after reloading the session, so plan mode is never shown on while the runtime has dropped it.

## Consequences

- Plan mode only removes authority; leaving it restores exactly the grants and approvals the
  session had.
- The `[Plan mode]` paragraph is part of the recorded user message, so requests stay
  reconstructable from history.
- A denied change is recorded as a denied effect, so the model sees why its call did not run.

## Rejected

- A model-callable "exit plan mode" tool: only the owner may approve a plan.
