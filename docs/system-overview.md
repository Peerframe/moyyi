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
| Unmerged product candidate | [PR #25](https://github.com/Peerframe/moyyi/pull/25), reviewed product `69312969533659578cc1da21b510d8395a099ef3` | Range reads, evidence guidance, configurable reasoning, search context, exact-file/filter/files-mode navigation, safe schema errors and two additional source tasks. The eval host preserves explicit reasoning effort. Native numbered source evidence and explicit remaining tool opportunities now extend this candidate; API profile v2 prevents mixing old recordings. Opt-in path context and required-only compaction savings are also included. These are not merged-main capabilities. |
| Current offline product correction | Product `69312969533659578cc1da21b510d8395a099ef3`; [ADR 0027](https://github.com/Peerframe/moyyi/blob/69312969533659578cc1da21b510d8395a099ef3/docs/decisions/0027-bounded-workspace-navigation.md) | Bounded path context is default-off, refreshed, permission checked and optional under capacity. Required-only compaction comparison prevents false savings. Default local check 2056/2056, instruction conformance 32/32 and [exact-head CI](https://github.com/Peerframe/moyyi/actions/runs/40305112704) passed. No new real-model quality result. |
| Unmerged documentation candidate | [PR #26](https://github.com/Peerframe/moyyi/pull/26), plan baseline `b846e45842d7ac33fd85239454c411522cc8a05c`; this update preserves the installed correction’s failed live follow-up and records the installed offline navigation correction | The system entry and the current optimization plan are delivered here. Product optimization continues in existing PR #25; neither PR is merged or stacked on the other. |
| Owner's installed candidate | Product `69312969533659578cc1da21b510d8395a099ef3`; package SHA256 `12b2aee9c116e432ab23780c32c793adc094708995dc7d7f393a1ac1fe3774a5` | Clean package, 244 installed-file identities, CLI10/client10/PTY5/type checks passed. Installed scripted four-request read/create/verify/final-none passes the original public checker; unrelated write denied. Actual CLI resume/help/exit passed. Host explicitly enables navigation and retains Flash + Responses + low, read-only access, three requests and zero retries. Zero real API requests/key reads for this upgrade. |
| Latest autonomous investigations | [Live follow-up on the installed correction](https://github.com/Peerframe/moyyi/blob/a04707c1ca37f35d7f1d1d916b4a44c84f128318/docs/tasks/2026-10-26-readable-evidence.md) | Eight newly authorized requests total, four per task, zero retries, Flash/Responses/low. Native tool-text continuation accepted. Original six criteria: three pass, three partial, overall failure, plus an incorrect default-policy inference. Public 11 facts correct, required report absent: official failure. Both source snapshots unchanged. The grant is exhausted; one run each is not stability evidence or the original historical eight-request task budget. |
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
| Inspect a project and explain its behavior | File tools, instructions, context, provider and final answer | Real tool continuation and bounded final closeout; candidate source windows, exact scopes, filters and discovery outputs are verified against actual files; opt-in path context and scripted read/create/verify delivery now have offline evidence | The latest live follow-up still fails the full original criteria and public file delivery. Native tool-text transport is accepted; one trial per task is not a reliability baseline. |
| Change files, inspect changes and undo | [Write grant, approvals, snapshots](writes.md); shell grant if checks need a process | Real filesystem/SQLite offline checks, conflict/revocation/recovery cases | No comparable end-to-end live-model project-edit score. The owner's normal host remains read-only. |
| Run commands and stop them | [Shell plugin](shell.md), explicit process grants, supported native sandbox/toolchain | Native-process conformance and documented platform tests | macOS detached descendants/host hard-kill limitations remain. Docker is a planned optional adapter, not an implemented fallback. |
| Continue long work without losing state | [Store and long sessions](long-sessions.md), resume, explicit compaction | Crash/recovery tests and scripted compaction lifecycle; local resume startup verified | Real-model summary fidelity, long-task quality and cache savings are unmeasured. |
| Apply project guidance and reusable Skills | [Instructions](instructions.md), [Skills](skills.md), trusted selection and read grants | Refresh, selection, bounds and authority conformance; [OpenBot reuse](openbot-provenance.md) already includes YAML-validation experience | Guidance quality is not guaranteed by correct loading; automatic nested instruction discovery is not implemented. |
| Research online or use another provider | [Web](web.md), configured SearXNG/grants, [Anthropic](anthropic.md) | Offline protocol/authority and HTML extraction checks | Live Anthropic/SearXNG acceptance, browser and binary-document workflows are unverified or outside current support. |

## Locate the right owner before choosing a fix

| Concern | Implementation entry | First evidence to consult |
|---|---|---|
| Wrong launch/configuration/version | [CLI program](../src/cli/program.ts), [runtime composition](../src/runtime/index.ts) | [Installation](installation.md), [client protocol](client-protocol.md), actual host/package identity |
| Incorrect source navigation or unhelpful tool output | [fs plugin](../src/plugins/fs/index.ts), [file capability](../src/runtime/files.ts), [argument validator](../src/runtime/validation.ts); candidate [navigation plugin](https://github.com/Peerframe/moyyi/tree/69312969533659578cc1da21b510d8395a099ef3/src/plugins/workspace-navigation) | [File contract](files.md), `eval:files`, actual tool arguments/results |
| Evidence omitted from the model request | [Context collector](../src/runtime/instructions.ts), [context builder](../src/context/index.ts), [core loop](../src/core/index.ts) | [Context tests](../src/context/index.test.ts), request records, `eval:instructions` |
| Evidence arrived but answer is wrong | [Provider](../src/plugins/provider-deepseek/), model configuration and complete request; default guidance as one input | Fixed-source final answer versus required facts; [runtime task evaluation](runtime-evaluation.md). Do not assume a transport or retrieval bug. |
| Wrong tool execution/authority | [Executor](../src/core/executor.ts), [policy](../src/policy/index.ts), capability implementation | Effect/policy tests, [threat model](threat-model.md), actual side effects; never repair by loosening a grant |
| Lost state, repeats, interruption | [Core](../src/core/index.ts), [store](../src/store/), request/recording paths | [Recovery tests](../tests/core-recovery.test.ts), `eval:long-sessions`, journal and transcript |
| Misleading success or comparison | [Task runner](../evals/harness/runner.ts), [runtime adapter](../evals/agents/moyyi.ts), [task selection](../evals/cli.ts) | [Corpus](../evals/corpus.md), actual capabilities, [comparison protocol](research/harness-comparison.md) |

## Current diagnosis, including what is not established

1. **Four demonstrated tool gaps are closed in the candidate.** Exact-file search, bounded
   file-pattern filtering, files-only discovery and safe field errors are implemented in `520ef82`.
   Offline and installed checks remain valid. The fixed two-task run exercised the new discovery,
   filtering and exact-file interfaces successfully; that does not establish task correctness.
2. **Full-chain and lifecycle claims remain incomplete after the follow-up.** The current answer
   correctly distinguishes raw-text preservation from parsed fields and describes real mtime/ctime
   checks. It still omits runtime/core/render consumers, changing skill selection by rebuilding the
   runtime, and an explicit no-automatic-references/scripts statement. It also extrapolates the
   default permission policy without reading it. The original rubric remains three pass/three
   partial, overall failure; improved individual claims do not establish stable accuracy.
3. **The public task fails in action ordering, with evidence already available by the final request.**
   All four inputs arrive intact and the final JSON has eleven correct facts. But source is read
   only in the third, last tool-capable request; its result first reaches the fourth no-tool request.
   The model does not create the report despite the last-tool notice. A legitimate four-request
   sequence exists with the current tools and authority, so neither more tools nor more warnings
   can be presumed to fix the planning failure. A temporary answer projection passes the checker
   only as a diagnostic; the actual task remains failed.
4. **The overall record stays tied to observed results.** This page owns the product snapshot;
   historical briefs are evidence, not a standing queue. Do not claim a new product-quality fix from
   the helper patch, repeat exhausted budgets, or keep expanding search after decisive evidence arrived.

5. **A subsequent product correction is installed and its native wire format has live evidence.**
   [ADR 0026](https://github.com/Peerframe/moyyi/blob/c3b128b1b9865bf191b291fa2a3c2b0584888dfe/docs/decisions/0026-readable-evidence-and-action-budget.md)
   pins OpenCode, Goose and Aider source/tests and the DeepSeek protocol. The correction removes
   nested model-visible JSON around read source, preserves numbered source/metadata/continuation
   under existing bounds, and reports the last tool opportunity before the final no-tool request.
   It adds neither a framework nor a universal factual verifier. Local bounded-concurrency tests
   passed 1993/1993; the unchanged default Linux CI passed 1992 with one existing platform skip,
   all conformance steps and package acceptance. The owner's installed runtime passed three
   synthetic mechanism scenarios. The new eight-request live follow-up accepts native tool text but still fails both task criteria; offline mechanism results do not certify autonomous factual correctness.

6. **Opt-in path context addresses the demonstrated discovery delay; task quality is still unverified.**
   [ADR 0027](https://github.com/Peerframe/moyyi/blob/69312969533659578cc1da21b510d8395a099ef3/docs/decisions/0027-bounded-workspace-navigation.md) follows Aider's request-time orientation and compares task lists and stop hooks.
   The host may enable a bounded list of relative paths before the first response, refreshed on
   each collection. The plugin adds no source summaries, inferred facts, answer hints or tool
   authority. Runtime still checks list/read permissions, ignore rules, protected paths, aliases,
   revocation and cancellation. The optional section cannot displace required context or enlarge
   the existing capacity. A scripted real-runtime/filesystem/SQLite scenario now reads, creates,
   verifies and closes within four requests under the original public checker, with unrelated
   writes denied. This proves a feasible path, not model planning or correct interpretation.
   Review found and fixed an optional-section compaction accounting defect: required context is
   compared on both sides. Three runtime regressions cover changing navigation admission and
   true/false summary savings. Final default checks pass 2056/2056; the exact-head CI, clean
   package and installed scenario pass. See the [delivery record](tasks/2026-10-26-optimization-plan.md).
   This round used zero paid requests; the previous eight-request grant stays exhausted and sealed. Neither
   real-task failure is relabeled, and the installed version in the table remains a separate fact.

The [upstream source comparison](research/2026-10-26-agent-navigation.md) supports improving the
tool contract and measurement together. It does not justify a new agent core, universal factual
verifier, mandatory subagents, full-repository graph or larger request allowance.

## Next bounded delivery and decision rules

The owner has authorized planning first, then targeted optimization. The
[current delivery plan](tasks/2026-10-26-optimization-plan.md) expands the following three levels;
it is the scoped execution record for this checkpoint, not a new planning system. The plan updates
PR #26, while product work continues in PR #25. No new stacked PR or automatic merge is required.

| Level | User result and deliverable | Exit condition and evidence boundary |
|---|---|---|
| 1 — delivered offline in PR #25 | Make source investigation tools select the requested material and explain repairable input errors: exact file/directory scope, bounded include/exclude globs, `files`/`content` search modes and safe field-level schema errors | Real disposable-file/runtime probes establish exact scope, filtering, deduplication, bounded results and actionable errors; denial/revocation/cancellation and existing task checks still pass. This proves tool behavior, not reliable model conclusions. [Implementation and installation evidence](https://github.com/Peerframe/moyyi/blob/8b74bed/docs/tasks/2026-10-26-investigation-navigation.md): default check 1929/1929, file eval 13/13, clean package and installed scenarios 5/5; implementation CI passed. |
| 2 — fixed diagnostic delivered; targeted correction delivered offline | Two preselected autonomous tasks: original project question and public source-dataflow-report, four requests each; opt-in path orientation targets the observed late discovery | Original six criteria and public checker unchanged; both the earlier diagnostic and the new installed-correction follow-up fail. Latest original: three pass/three partial plus one unsupported default-policy claim. Latest public: eleven correct facts, no file. Eight new requests used and sealed, no remaining authorization; same four-per-task allocation as the preceding run, still not reliability evidence or a full historical eight-request original-task test. |
| 3 — later user workflows | Establish controlled editing, long-session fidelity and online-research outcomes | Independently verify modification/checks/review/undo; retained facts and unfinished work across resume/compaction; and actual service/source quality for online research. Each outcome needs its own bounded task and evidence; the current offline tool work does not close these gaps. |

Level 1 and the bounded level-2 diagnostic are delivered. General task quality is still unproven.
The installed follow-up addresses source presentation and action-opportunity reporting, with
[implementation, CI and installation evidence](https://github.com/Peerframe/moyyi/pull/25).
It preserves final-tool protection and does not introduce task-specific answer hints. The native wire format is now accepted in the live follow-up. Full-chain/default-policy verification
and autonomous discovery/read/write ordering remain unsolved under the unchanged task criteria.
The new eight-request grant is also exhausted. The [current path-navigation correction](https://github.com/Peerframe/moyyi/blob/69312969533659578cc1da21b510d8395a099ef3/docs/tasks/2026-10-26-readable-evidence.md)
removes an initial discovery dependency in the scripted public workflow without changing the
question, source snapshot, checker, request count or model. Final compaction validation, clean
packaging, actual installation and exact-commit CI passed as recorded above. No new live calls
were made for this correction; the previous task failures remain unchanged.
Level 3 has not started.

Level 1 preserves `contextLines` 0–20, every existing request/input/output/scan/time limit,
Flash + Responses + low, and the original six criteria. It changes the existing guarded file
capability, tool contract and argument validation, not prompts, the core loop or persisted format.
It adds no LSP, repository graph or additional agents. File filters never grant access or silently
hide tests; invalid-input feedback must not echo arbitrary values or private content.

Stop an ineffective line of work when its claimed failure is no longer observed: if the required
evidence reaches the model but conclusions still fail, stop expanding search and isolate
interpretation/answer construction. If navigation improvements do not improve evidence selection
under unchanged limits, do not keep widening context or adding tools without a demonstrated gap.
Once the defined offline exit conditions pass, finish that delivery rather than adding unrelated
mechanism tests; keep observed failures and remaining live-quality gaps explicit. A compatible
mature-harness comparison or future index is useful only when it can resolve a concrete remaining
question, under a new bounded run.

GUI, MCP/memory, additional models and training remain roadmap work. Reuse from OpenBot follows a
demonstrated need and [provenance rules](openbot-provenance.md), without migrating the old product
roles or treating new capabilities as proof that existing tasks are correct.

## Keep this useful

For substantial work, state the user outcome, affected path through the diagram, evidence-backed
failure layer, proposed change and finite exit condition. Read only the relevant linked owners.
Routine implementation choices stay with the agent; accepted decisions are not reopened by old
task text. Scope-changing owner decisions remain explicit in the applicable brief.

When a candidate is installed, a PR is merged or a real task is assessed, update the coordinate
table and the affected outcome/next-delivery row together. Link immutable evidence and distinguish
implemented, offline-verified, live-verified, failed and unmeasured. Keep transcripts and credentials
private. Do not duplicate changing test totals or a second current backlog in README/architecture.
