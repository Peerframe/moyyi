# System overview and current engineering direction

This is the starting point for reasoning about moyyi as a product. It connects user outcomes,
implementation owners, evidence and the next delivery. It is not another layer specification:
[architecture](architecture.md) owns boundaries, [ADRs](decisions/) own decisions,
[roadmap](roadmap.md) owns future scope, and dated [task records](tasks/) preserve historical results.

## Product goal and current checkpoint

moyyi is a new personal, general-purpose agent with a self-owned core. Success means completing
useful tasks correctly, within the user's authority, with recoverable state and understandable
results. A working loop or a large passing test suite is necessary but does not establish that
success. OpenBot contributes selected technology and failure experience through moyyi's own
contracts; it does not supply a bot-cluster architecture. Model training, including shasha/Qwen,
is deferred. Accepted D1–D6 remain in force.

**Current checkpoint: a reliable read-only project investigation.** The product already has
write, process and web capabilities, but enabling more tools does not resolve the present failure:
finding the needed implementation and making consistent claims from it. This checkpoint does not
redefine the whole product as a coding-only agent or cancel later capabilities.

## Version and evidence coordinates

Audited on **2026-10-26**. These are evidence snapshots, not moving branch guarantees; check Git
and the referenced PR before changing code. No current authorization is inferred from old records.

| Coordinate | Audited state | What it means |
|---|---|---|
| Merged product baseline | `b2d4790fda242d2ff8ba7bc3f8306bc2e06743a9`, through [PR #24](https://github.com/Peerframe/moyyi/pull/24) | Includes core/store/CLI, file writes, native process sandbox, web, Skills, runtime evals and bounded request closeout. |
| Unmerged product candidate | [PR #25](https://github.com/Peerframe/moyyi/pull/25), reviewed head `650a00b06bcabc308d9cebeffc0e037658eb6457` | Range reads, evidence guidance, configurable reasoning, search context and two additional source tasks. These are not merged-main capabilities. |
| Owner's installed candidate | Product `b019f30229a76a3dbe502ee5786ccf5bbb7f5a3e`; later PR head only adds its task record | Exact package/installation checks passed. Host uses Flash + Responses + low; the ordinary read-only host's three-request limit is separate from the eight-request acceptance run. This is a local configuration, not a library default. |
| Latest autonomous investigation | [Fixed PR #25 result](https://github.com/Peerframe/moyyi/blob/650a00b06bcabc308d9cebeffc0e037658eb6457/docs/tasks/2026-10-26-search-context.md) | Eight requests, zero retries, normal final answer, original six criteria **not passed**. Lifecycle explanation improved in that run; consumers and raw-text/authority claims remain incomplete or contradictory. |
| Public release | None | Local candidate installation is not npm/GitHub publication or a release tag. |

The corpus has 30 tasks on this main baseline; PR #25 adds two. Reference/checker tests and scripted
conformance are not real-model corpus results. No same-model, same-budget comparison with a mature
harness has been executed. Earlier full-source and model/effort diagnostics are recorded in
[PR #25's fixed evidence record](https://github.com/Peerframe/moyyi/blob/650a00b06bcabc308d9cebeffc0e037658eb6457/docs/decisions/0022-evidence-guidance-and-focused-reads.md)
and [reasoning record](https://github.com/Peerframe/moyyi/blob/650a00b06bcabc308d9cebeffc0e037658eb6457/docs/tasks/2026-10-26-configurable-reasoning.md).
Do not repeat those experiments merely because a new contributor has not read them.

## One task through the whole system

```mermaid
flowchart TD
  U[User task and constraints] --> C[CLI or client protocol]
  H[Explicit trusted host: model, credentials, grants, limits] --> R[Runtime composition]
  C --> R
  R --> K[Core run and request budget]
  K --> X[Collect and build context]
  I[Default/project instructions and selected Skills] --> X
  S[(SQLite, transcript, request and effect records)] --> X
  X --> M[Provider adapter: one model attempt]
  M --> D{Answer or tool calls}
  D -->|calls| V0[Schema validation]
  V0 --> P0[Before-prepare read permission]
  P0 --> T[Tool preparation]
  T --> P[Before-execute policy and approval, when required]
  P --> E[Scoped file, process or web capability]
  E --> S
  E -->|bounded observations| K
  D -->|answer| A[User-visible result]
  K --> S
  A -. independent task assessment .-> V[Evidence coverage, factual result, forbidden effects]
```

The assessment box is an engineering activity, not a hidden production truth checker. A model
claim, plan status or successful tool return cannot certify that the user's task is correct.
Instructions and source text can inform the model; they cannot grant tool authority. Persistence,
recovery and cancellation apply throughout the loop, not only after an answer.

## What can a user do, and what is actually verified?

| User outcome | Entry and dependencies | Available evidence | Remaining limit |
|---|---|---|---|
| Start, resume and use a local agent | [CLI](cli.md), explicit host, Node/toolchain, credentials for live use | [Installed CLI/PTY/client acceptance](installation.md); a bounded DeepSeek file/tool continuation passed after #19 | Setup still requires trusted host configuration. A successful connection is not task competence. |
| Inspect a project and explain its behavior | File tools, instructions, context, provider and final answer | Real tool continuation and bounded final closeout; candidate source windows are verified against actual text | Latest original project task still fails factual criteria; no representative real-task quality baseline. |
| Change files, inspect changes and undo | [Write grant, approvals, snapshots](writes.md); shell grant if checks need a process | Real filesystem/SQLite offline checks, conflict/revocation/recovery cases | No comparable end-to-end live-model project-edit score. The owner's normal host remains read-only. |
| Run commands and stop them | [Shell plugin](shell.md), explicit process grants, supported native sandbox/toolchain | Native-process conformance and documented platform tests | macOS detached descendants/host hard-kill limitations remain. Docker is a planned optional adapter, not an implemented fallback. |
| Continue long work without losing state | [Store and long sessions](long-sessions.md), resume, explicit compaction | Crash/recovery tests and scripted compaction lifecycle; local resume startup verified | Real-model summary fidelity, long-task quality and cache savings are unmeasured. |
| Apply project guidance and reusable Skills | [Instructions](instructions.md), [Skills](skills.md), trusted selection and read grants | Refresh, selection, bounds and authority conformance; [OpenBot reuse](openbot-provenance.md) already includes YAML-validation experience | Guidance quality is not guaranteed by correct loading; automatic nested instruction discovery is not implemented. |
| Research online or use another provider | [Web](web.md), configured SearXNG/grants, [Anthropic](anthropic.md) | Offline protocol/authority and HTML extraction checks | Live Anthropic/SearXNG acceptance, browser and binary-document workflows are unverified or outside current support. |

## Locate the right owner before choosing a fix

| Concern | Implementation entry | First evidence to consult |
|---|---|---|
| Wrong launch/configuration/version | [CLI program](../src/cli/program.ts), [runtime composition](../src/runtime/index.ts) | [Installation](installation.md), [client protocol](client-protocol.md), actual host/package identity |
| Incorrect source navigation or unhelpful tool output | [fs plugin](../src/plugins/fs/index.ts), [file capability](../src/runtime/files.ts), [argument validator](../src/runtime/validation.ts) | [File contract](files.md), `eval:files`, actual tool arguments/results |
| Evidence omitted from the model request | [Context collector](../src/runtime/instructions.ts), [context builder](../src/context/index.ts), [core loop](../src/core/index.ts) | [Context tests](../src/context/index.test.ts), request records, `eval:instructions` |
| Evidence arrived but answer is wrong | [Provider](../src/plugins/provider-deepseek/), model configuration and complete request; default guidance as one input | Fixed-source final answer versus required facts; [runtime task evaluation](runtime-evaluation.md). Do not assume a transport or retrieval bug. |
| Wrong tool execution/authority | [Executor](../src/core/executor.ts), [policy](../src/policy/index.ts), capability implementation | Effect/policy tests, [threat model](threat-model.md), actual side effects; never repair by loosening a grant |
| Lost state, repeats, interruption | [Core](../src/core/index.ts), [store](../src/store/), request/recording paths | [Recovery tests](../tests/core-recovery.test.ts), `eval:long-sessions`, journal and transcript |
| Misleading success or comparison | [Task runner](../evals/harness/runner.ts), [runtime adapter](../evals/agents/moyyi.ts), [task selection](../evals/cli.ts) | [Corpus](../evals/corpus.md), actual capabilities, [comparison protocol](research/harness-comparison.md) |

## Current diagnosis, including what is not established

1. **Tool ergonomics is a demonstrated gap.** The reviewed candidate rejects exact-file search,
   offers no file-pattern filter or files-only discovery mode, and schema failures hide the
   failing field. Synthetic probes reproduce these independently of a model. Increasing nearby
   lines does not add those navigation choices.
2. **Retrieval is not the whole failure.** Earlier supplied-source diagnostics and recent answers
   contradict text already delivered. The latest run correctly explains configuration lifetime,
   but that is one outcome, not reliable cross-task evidence.
3. **Development measurement is incomplete.** We have substantial mechanism tests and repeated
   runs of one project question. We do not yet have a representative real-task baseline or a
   controlled mature-harness comparison. More mechanism tests alone cannot close this gap.
4. **Documentation drift obscured the critical path.** Entry documents mixed historical branches,
   installed candidates and merged features. This page now owns the dated product snapshot;
   historical briefs are evidence, not a standing queue of work.

The [upstream source comparison](research/2026-10-26-agent-navigation.md) supports improving the
tool contract and measurement together. It does not justify a new agent core, universal factual
verifier, mandatory subagents, full-repository graph or larger request allowance.

## Next bounded delivery and decision rules

The next product delivery is **one coherent investigation-tool contract**, followed by measurement
of the entire task. It has not been implemented by this documentation change.

| Order | Deliverable | Observable exit condition |
|---|---|---|
| 1 | Exact file/directory scope, bounded include/exclude selection, files-versus-content output, actionable schema errors through the existing read capability | The same synthetic navigation probes work; exact-file search never expands to siblings; filtered searches preserve ignore/protected-path/revocation guarantees; scope, omissions and bounds remain visible. No extra model call is needed for the mechanism. |
| 2 | Run the existing task harness against a fixed representative selection, retaining the original project task | Use source dataflow/lifecycle candidates plus existing research/data-consistency tasks. Confirm required capabilities first: many public research tasks write `report.json`, so a read-only profile cannot be scored as if it supported them. Keep checkers unchanged and report unsupported tasks separately. |
| 3 | Compare old/new navigation, then a compatible mature-harness baseline only if it resolves an outstanding question | Same model/API/effort, source, per-task limits and total authorized budget. Report evidence delivered, final facts, false success, errors, requests and bytes separately. Never spend the previous exhausted eight-request grant again. |

Do not add LSP or a repository graph before the basic interface comparison establishes remaining
navigation loss. If delivered evidence is sufficient and conclusions still fail, stop changing
search and isolate interpretation/answer construction with the existing task cases. A missing
consumer is not repaired by an unsupported final claim; a known incorrect claim is not repaired
by counting more files read. The original six criteria remain required for that original task.

Writes, long sessions and online research need their own user-outcome acceptance later. GUI,
MCP/memory, additional models and training remain roadmap work, not ways to hide the current gap.
Reuse from OpenBot is selected by a demonstrated need and [provenance rules](openbot-provenance.md),
not by a goal of migrating the old product wholesale.

## Keep this useful

For substantial work, state the user outcome, affected path through the diagram, evidence-backed
failure layer, proposed change and finite exit condition. Read only the relevant linked owners.
Routine implementation choices stay with the agent; accepted decisions are not reopened by old
task text. Scope-changing owner decisions remain explicit in the applicable brief.

When a candidate is installed, a PR is merged or a real task is assessed, update the coordinate
table and the affected outcome/next-delivery row together. Link immutable evidence and distinguish
implemented, offline-verified, live-verified, failed and unmeasured. Keep transcripts and credentials
private. Do not duplicate changing test totals or a second current backlog in README/architecture.
