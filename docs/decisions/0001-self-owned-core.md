# 0001: Self-owned agent core

Status: accepted (2026-10-24)

## Decision

The run loop, internal messages and events, tool scheduling, permissions, budgets, cancellation,
error handling, session recovery and context management are implemented in moyyi. Pi, PydanticAI,
DSH and similar frameworks are not used as the runtime kernel, and no whole product is forked.
Foundational libraries (HTTP, validation, database drivers) may be used.

## Reason

The parts most likely to change are the session format, lifecycle and recovery semantics.
Adopting a framework's versions of these would bind moyyi to its interfaces and migrations.

## Cost, stated honestly

The loop itself is small. The ongoing cost is provider protocol details, tool ergonomics and
prompts, which other frameworks maintain for their users. Existing frameworks may be read as
references or used as test oracles.

## Relationship to OpenBot

Loop, contracts, sessions, recovery, permissions and default prompts are written from scratch.
Failure scenarios and their tests are ported as knowledge; see
[openbot-provenance.md](../openbot-provenance.md).
