# ADR 0018: Connect task evaluation to the existing runtime

Status: accepted for this implementation, 2026-10-26. D1–D6 are unchanged.

## Problem and evidence

The 30 public tasks have independent final-state checkers, but the CLI exposed only a null agent.
Runtime conformance suites used separate small scenarios and did not prove that the task harness
could maintain a real conversation or bound client invocations across trials.

This is wiring within the existing [architecture](../architecture.md), ModelClient/runtime ports,
[working-instruction decision](0017-working-and-project-instructions.md) and
[same-model measurement protocol](../research/harness-comparison.md). Those accepted choices do
not need a second agent framework. No external code, OpenBot implementation or dependency is
copied or introduced. The reviewed base is main `eee3beed4f392112f97c0bbdbd021d583355b6df`.

## Decision

Add a repository-source `AgentUnderTest` adapter that invokes the public runtime. The model sees
only user instructions and the selected disposable workspace, with the runtime's normal system
context. Reopen the same SQLite session between turns; close runtime handles before returning;
provide `disposeTrial` for error-safe cleanup of separate temporary state before fixture removal.
The adapter is sequential and does not grant new product capabilities.

An explicit model host declares synthetic/live source, profile and a lazy client factory. A shared
wrapper reserves a model-port attempt before factory/stream invocation. Runtime retries are zero;
task budgets and one suite-wide allowance both apply. Reservations are never refunded. This
counter bounds a compliant client's invocations, not actual HTTP traffic or billed currency.
Live execution requires an explicit flag plus a request allowance; no environment/key discovery.
The CLI loads only public tasks unless private loading is explicitly requested. Host modules are
trusted executable code; a source label is not isolation for their imports or factories.

Capabilities default to read-only. Explicit write/shell profiles grant only each fresh workspace,
using existing policy, snapshots and native sandbox. Toolchain configuration copies only named
read-only path fields. No web grant, `.git` exception, permission widening for scores or unsafe
fallback is added. Missing operations remain visible limitations.

Add a uniform final-answer format via an ordinary context source: strict JSON `status` and
`summary`. Only the last assistant message in a completed final turn supplies claimed success.
Normal stop reasons, prior claims, file state and checker results cannot manufacture it. Missing
or ambiguous reports are unknown. Existing task checkers/expectations and grader thresholds are
unchanged. Incomplete runtime outcomes additionally fail the trial even if its file state looks
correct. Result metadata distinguishes synthetic wiring evidence from live task attempts; usage
keeps unknown counters rather than inventing zero or estimated cost.

## Tradeoffs and validation

The format instruction is an evaluation-specific prompt addition, so comparison runs must disclose
it and keep reporting conditions consistent across agents. Temporary conversations are removed;
results retain normalized counts/verdicts, not raw transcripts or credentials. Additional sanitized
trace capture can be designed when an actual authorized comparison needs it.

Offline conformance runs the real runtime, SQLite, workspace tools and native shell on a separate
small fixture, with scripted model responses. Tests cover quota exhaustion across turns/trials,
no automatic retry, restart history, claim ambiguity, read-only/escape denial, cancellation and
cleanup. CLI tests ensure model/private loading is opt-in and host/key access stays lazy. Public
fixtures, hidden checkers and reference answers remain unchanged. No paid-model corpus run or
model-quality claim is part of this acceptance.

See [usage and capability gaps](../runtime-evaluation.md) and the
[delivery brief](../tasks/2026-10-26-runtime-evaluation.md).
