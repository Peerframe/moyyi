# Runtime task evaluation

`npm run eval` defaults to the null baseline and the public 30-task corpus. It does not discover
a model, environment key, saved CLI host, or private corpus. The `moyyi` adapter runs the real
runtime, default/project instructions, SQLite sessions, policies and tools. It supplies only each
user instruction, previous conversation and the disposable workspace; it never receives the task
ID, checker, reference solution or expected outcome. Public checkers and answers are unchanged.

## Offline checks and CLI smoke

Use Node 26 from a source checkout:

```bash
npm run eval:runtime
npm run eval -- --agent moyyi --host ./evals/agents/synthetic-blocked.ts \
  --source synthetic --max-model-requests 1 --task fix-range-off-by-one
```

The first command checks ten independent wiring scenarios with scripted responses, real SQLite,
real files and a native sandboxed shell. It covers read/write, session reopen, default denial,
confinement, suite/trial/multi-turn budgets, failure without retry, cancellation and shell execution.
It is also a CI gate. It does not contain answers to the public corpus.

The second command verifies the actual public-task CLI. Its model always reports blocked and
changes nothing, so the selected task must fail. A failed task is normal eval output, not a CLI
infrastructure failure; configuration/runtime harness errors exit with code 2. This synthetic host
is not a task-solving agent. Its scores, including any correctly blocked task, measure no model
quality or prompt-injection resistance. Result files mark `synthetic-conformance` explicitly.

## Programmatic model host

`createMoyyiEvalAgent` in `evals/agents/moyyi.ts` accepts an explicit model profile and a lazy
`createClient()` factory for the existing `ModelClient` port. A client performs exactly one model
attempt per `stream` invocation and must observe cancellation. No retry loop belongs in a host.
The same factory may return a shared scripted client across turns. Each turn opens a runtime on
the trial's same SQLite session and closes it before returning. Trials have separate state.

The CLI loads the default export of an explicitly named local `--host` module. This is trusted
executable code: import itself is not sandboxed, and the `source` declaration cannot prove an
arbitrary module is offline. Keep construction/import free of network and credential reads.
`--source synthetic|live` must match the exported declaration; invalid options and a missing
live opt-in are rejected before importing the module.

For DeepSeek, the repository-source helper `deepSeekEvalHost` in `evals/agents/deepseek.ts` reuses
the existing DeepSeek codec and fixed-origin, no-redirect HTTP transport. A host can supply:

```ts
import { deepSeekEvalHost } from "/path/to/moyyi/evals/agents/deepseek.ts";
import { readMyAuthorizedCredential } from "./my-private-credential-reader.ts";

export default deepSeekEvalHost({
  getApiKey: readMyAuthorizedCredential,
  reasoningEffort: "low",
});
```

The credential reader is host-owned, outside the eval workspace, and is called lazily only after
a model attempt has reserved its allowance. This example defines an integration contract; it does
not install a credential reader. Do not put a key in source, command-line arguments or fixtures.
No host/credential settings from the interactive CLI are loaded automatically.

The eval helper accepts `none`, `low`, `high` or `max`, captured when the host is constructed.
Omitting `reasoningEffort` retains the provider's existing `high` default; the example explicitly
chooses `low`. Record the returned `reasoningEffort` and `apiProfile` with the trial manifest.
The generic eval summary records the model identifier, not these provider-specific settings.
This helper registers its own model client, so a separate interactive runtime setting cannot
configure its effort. Invalid efforts fail before credentials or transport are used.

A live command additionally requires `--allow-live`, an explicit `--max-model-requests N` and an
authorized budget. Merely adding a live-capable helper does not authorize a paid run. The helper's
wire-setting and runtime tests use synthetic responses. Initial live use should select one public task before a
larger suite; apply the [same-model comparison protocol](research/harness-comparison.md).

## Budgets and authority

The shared allowance counts reserved **model-port attempts**, before calling the client factory
or `stream`. It spans turns and trials, and is not refunded after credential/factory failures,
provider errors, cancellation or timeout. It does not measure actual HTTP requests, billed tokens
or money. A compliant DeepSeek client performs at most one HTTP attempt per invocation; custom
hosts must obey the same contract. A cap of N attempts is not a currency ceiling.

Each task's existing request/time budget also remains in force. A turn receives only its remaining
budget; runtime retries are always zero. Exhaustion prevents another client invocation, including
on later trials. Those trials remain failed/incomplete in the denominator rather than being
silently omitted. Usage records preserve `unknown`/`partial`/`final` and null counters. No token
cost is estimated and no missing counter becomes zero.

`--capabilities` defaults to `read`. `write` explicitly grants controlled creation/edit/undo only
within each disposable trial workspace. `shell` additionally grants the existing native sandbox;
network and protected paths remain denied. A trusted host may specify exact read-only toolchain
paths through `toolchain.executablePaths` and `toolchain.readOnlyPaths`; it cannot override the
trial roots or approval policy through that object. Unsupported or unavailable operations must
be reported honestly; there is no unsandboxed fallback, web grant or owner-directory write grant.
Unexpected approval requests are denied.

The harness is sequential. Concurrent calls on one adapter are rejected. An outer cancellation
cancels the active runtime and waits for it to settle before closing storage. `runSuite` disposes
each trial, including error paths, before removing its fixture; standalone callers must call
`disposeTrial(sessionId)` and ultimately `close()`. Cancel and await an active turn before closing.
Temporary conversation data is removed after evaluation; it is not added to JSON results.

## Reporting and known capability gaps

A uniform `eval-report-v1` context source requests a final JSON object with exactly `status`
(`done` or `blocked`) and a nonempty `summary`. Only the final assistant message of the last
completed turn can supply the claim. Missing, malformed, duplicate-key, contradictory-structure
or ambiguous status is null. A normal `end_turn` is not success. Earlier claims, reasoning, tool
results, checker output and file existence cannot supply a missing declaration. Incomplete or
cancelled runs cannot pass just because their files happen to satisfy the checker.

This report is a claim, not the verdict. Existing final-state checks, protected-state checks,
stop-and-report requirements and false-success definitions decide the verdict unchanged. JSON
results record source/model, capability profile, request limit, retries, claim-format version,
per-trial allowance consumption, normalized usage and check results. For comparisons also record
the exact checkout, host configuration, OS/toolchain and provider settings required by the protocol.

| Capability | Current limitation for the public corpus |
|---|---|
| `read` | Even research tasks request output files. Read-only failures do not show that the model cannot research. |
| `write` | File tools cannot create parent directories, move/delete existing files or change metadata. `listing-sheet`, `js-to-ts-split`, `stale-cache-cleanup`, `vault-move`, `obsolete-engine-cleanup` and `metadata-batch-rename` need shell for these operations. |
| `shell` | Requires the existing supported OS sandbox and an explicitly available read-only Node/toolchain for coding checks. No network installation of missing tools or packages. |
| Git history | `.git` remains protected even with shell. `git-history-ci-repair` cannot inspect the required history with this adapter. Report this restriction separately from model performance. |
| Web/browser | No web or browser grant in this adapter. Existing research inputs are offline fixtures; live browsing is not claimed. |
| Documents | Seven formats use the native parser under ordinary reads. Fixed comparison/report tasks are prepared separately below; no real-model pass is claimed. |

The adapter never selects a weaker permission profile or marks an unsupported task passed. No
capability classifier is inferred from hidden task fields. Before a live comparison, record the
chosen capabilities and known unsupported cases; retain full per-task results and do not present
these limitations as model failures. No real-model corpus score or baseline comparison is available
from this offline delivery. Private tasks require explicit `--include-private` and separate
permission for their content; they were not read during implementation or checks.

## Prepared document acceptance group

The two fixed tasks in `evals/documents/tasks.ts` use the existing `EvalTask` contract and are kept
separate from the unchanged 32-task public corpus. `document-comparison-seven-formats` requires
`comparison.json` with all seven documents' facts, source hashes and exact one-sentence quotations.
`document-report-seven-formats` requires `report.json` with the approved-only total, approved and
blocked projects, earliest approved deadline and all seven source/hash/quote records. Sources must
remain byte-identical. Fixed synthetic fixtures are generated locally; reference/checker data never
enter a live model request. Checker tests reject missing output, wrong facts/calculation and source
mutation. Nothing is declared passed merely because the runtime ends normally.

Each task has a four-request ceiling. `npm run eval:documents` currently runs only scripted offline
conformance with real document parsing, SQLite persistence, controlled create/readback, default write
denial and final `none`. It makes zero paid requests. The task objects also work with `runSuite` and an explicitly authorized installed-runtime host;
no automatic live mode or key lookup was added to this CLI. On 2026-10-26, both fixed document tasks
passed once using Flash + Responses + low, four requests each and zero retries. The owner authorized
that document work without a total request cap; the first recorded baseline still retained 4+4.
The separate original regression group remains original source4 + public4 with its unchanged
rubric and authorization boundary. [Evidence and limits](tasks/2026-10-26-optimization-plan.md#文档真实任务验收2026-10-26). Document success cannot cancel an original-task failure.
If evidence is present but facts remain wrong, diagnose interpretation/answer construction rather
than automatically increasing retrieval or request counts.
