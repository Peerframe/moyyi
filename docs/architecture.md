# Architecture

moyyi is a personal, general-purpose agent with a small, self-owned core. Everything that is a
capability rather than a guarantee is a plugin. Start at the [system overview](system-overview.md)
for current capabilities, evidence and engineering priorities. This document owns layer boundaries;
[roadmap](roadmap.md) owns future scope and [decisions](decisions/) own accepted choices.

## Core and plugins

The **core** owns the guarantees: what is recorded, what is allowed, what happens on cancel and
crash. These cannot be replaced or bypassed by a plugin.

The **plugins** own the capabilities: which models, which tools, which context. They extend the
core through five fixed points and can be added or removed without touching anything else.

```
cli / desktop host ─┐   (future: automation — also a client)
             ▼
          runtime ─────────── plugin registry ◄──── src/plugins/<name>/
             │                                       provider-*, fs, shell,
   ┌─────────┼──────────┬──────────┐                 web, mcp, skills, memory …
   ▼         ▼          ▼          ▼
  core     store     context     policy
   └─────────┴──────────┴──────────┘
             ▼
         contracts ──► contracts/persisted   (the on-disk format, locked by fixtures)
```

### Core inventory

| Part | Path | Owns |
|---|---|---|
| Persisted format | `src/contracts/persisted` | Content parts, transcript tree, effect journal and its transition table, IDs. Versioned, locked by `fixtures/v<N>.ts` |
| Contracts | `src/contracts` | Model client contract and its conformance check, tool contract, ports, client protocol, plugin API |
| Core | `src/core` | Run loop, tool executor, approvals, budgets, cancellation and steering, error classification and retries, recovery |
| Store | `src/store` | SQLite, blob store, migrations, durability levels |
| Context | `src/context` | Rendering a model request, section ordering for prompt caching, compaction |
| Policy | `src/policy` | Base permission policy and approval modes |
| Runtime | `src/runtime` | Plugin registry, wiring, the client protocol |
| CLI | `src/cli` | Terminal client |
| Desktop client | `apps/desktop` | Sandboxed React renderer, validated local bridge and a trusted host using the public runtime; installed acceptance is tracked separately |

### Plugin inventory

| Plugin | Extension points | Phase |
|---|---|---|
| `provider-scripted` | model provider | exists (tests and evals) |
| `provider-deepseek` (Responses subset; [ADR 0007](decisions/0007-first-model-provider.md)) | model provider | implemented; connection/continuation evidence and task-quality gaps are separate in the system overview |
| `default-instructions` (original working guidance) | context source | implemented; static |
| `project-instructions` (workspace root AGENTS.md only) | context source | implemented; refreshed per request |
| `workspace-navigation` (opt-in bounded file paths) | context source | implemented; refreshed per request; real-model quality unverified |
| `fs` (read, list, search; create, edit, undo) | tools | read-only merged in batch 5; writes merged in phase 2 |
| `documents` (seven-format body text) | read-only tool; dedicated runtime parser port | implemented candidate; two fixed live document tasks passed once; broader quality unmeasured |
| `shell` | tools | merged in phase 3 |
| `provider-anthropic` | model provider | merged in phase 5; live acceptance pending |
| `provider-kimi` (Chat Completions; [ADR 0036](decisions/0036-kimi-chat-provider.md)) | model provider | opt-in K3.1 Pro; connection and task-quality evidence tracked separately |
| `web` (fetch, search) | tools; runtime capability and base policy | merged in phase 5 |
| `skills` (explicitly activated Agent Skills documents) | context source | implemented; refreshed per request |
| `mcp` (bridge to MCP servers) | tools, policy rule | later |
| `memory` (Hermes Agent–inspired learning) | context source, event observer | later |

Not plugins, because they are clients of the protocol: GUI, automation and scheduling. Sub-agents
need a decision when they are scheduled: most likely a tool that starts a child session through
the client protocol.

## Extension points

Defined in [plugin.ts](../src/contracts/plugin.ts):

| Point | A plugin can | A plugin cannot |
|---|---|---|
| Tool | Add a tool with its schema, effect profile, prepare, execute, reconcile | Skip validation, policy, approval or the journal; the executor runs those |
| Model provider | Add models and their profiles | Retry, loop or execute tools |
| Context source | Contribute sections, marked by stability and optional admission | Remove or reorder history, or hide unsettled effects |
| Policy rule | Return `ask` or `deny` | Return `allow`; a throwing rule denies |
| Event observer | Observe runtime events | Block or change a run; a throwing observer is recorded and ignored |

Loading is atomic. A plugin's registrations become visible only after its whole `setup`
succeeds; a failure removes everything it registered and runs its cleanups. Name conflicts fail
the later plugin. Each registration has one owner and disappears when the owner is unloaded.
Load failures are reported in `Runtime.plugins`, so clients never assume readiness. Batch 7 adds
explicit development loaders and the nonpersisted `plugin.reload`/`plugin.status` protocol. Runtime
admits reload only while idle, unloads first, then rebinds the core to current registrations while
retaining store/session/policy and unaffected provider clients. A failed replacement stays unloaded.
See [CLI usage](cli.md) and [ADR 0011](decisions/0011-interactive-cli-and-development-reload.md).
Development reload is incompatible with recording/replay and refreshes only explicit ESM entries.

### Desktop feature composition

[ADR 0045](decisions/0045-desktop-feature-modules.md) implements the desktop UI slots planned
in ADR 0005. `apps/desktop/feature-list.json` generates separate static contract, host, native and
renderer registries. Modules in `features/<id>` may import shared foundation code and their own
files, never another feature. Contracts are browser-safe and may use shared pure validation;
feature renderer imports are limited to React, shared design/bridge DTOs and its own views.
Feature host/native code retains the public runtime boundary. Only native entry points use Electron.

The host owns serialization, runtime/grant lifecycle and publication. Commands route to one
registered owner, unknown/duplicate actions fail, and runtime events reach every interested
projection. Each feature writes only its declared state slice; cross-feature resets belong to
fixed shared lifecycle transitions. Renderer features contribute declarative sidebar, right-panel,
dialog, settings-section and keyed conversation-node slots; the shell only places them. This is
build-time repository composition, not third-party loading or new execution authority.

### Trust

[ADR 0027](decisions/0027-bounded-workspace-navigation.md) adds explicitly enabled, path-only
workspace navigation through the context-source port. Runtime authorizes directory listing and
ignore-file reads separately, including restrictive plugin rules in both phases. The bounded
result is refreshed, revocable and untrusted. Context may omit optional sections when capacity
is insufficient; required sections, history and tools retain the original budget and failure
behavior. Neither paths nor the context plugin grant authority. See [setup](instructions.md).

[ADR 0017](decisions/0017-working-and-project-instructions.md) adds original default working
guidance and root AGENTS.md context. Runtime supplies a fixed-path, read-only capability under
an explicit `beforeContextRead` policy decision and restrictive plugin rules; missing grants or
approval-required reads do not load text. It expires after collection and follows run cancellation
and policy revocation. The plugins import no I/O. Root instructions refresh before each model
request, have a 16 KiB complete-file limit and retain source/hash in the recorded request. There
is no automatic nested/parent/home discovery. See [usage and limits](instructions.md).

[ADR 0019](decisions/0019-explicit-skills-context.md) adds explicit host-selected skills through
the same context-source lifecycle. A trusted host chooses one library root and at most eight
activated names; runtime exposes only their fixed SKILL.md documents after read-policy checks.
The plugin validates bounded YAML and renders source/hash/text as guidance. No discovery,
references, scripts or permissions are imported. See [Skills setup](skills.md).

| Kind | Runs | Trusted | Example |
|---|---|---|---|
| Built-in plugin | In process | Yes; reviewed in this repository | `fs`, providers |
| Local code plugin | In process | Yes, like any installed package; installed explicitly by the user | a personal tool |
| MCP server | Out of process | No; its effect profile is assigned by the `mcp` plugin, never by the server | third-party integrations |
| Skill | Data only | No authority; it is text in the context | Agent Skills folders |

## Layer rules

Enforced by [tests/boundaries.ts](../tests/boundaries.ts):

- `contracts/persisted` imports nothing else, so an interface change elsewhere cannot silently
  change the stored format.
- `contracts`, `persisted` and `core` import no Node built-ins and no packages; the world is
  reached through ports.
- Each `src/plugins/<name>` is its own layer: it imports only contracts and its own files, never
  another plugin or the internals, and never `node:fs` or `node:child_process`.
- Only `runtime` and `evals` import plugins.
- Desktop TypeScript and TSX are checked too. `apps/desktop/renderer` imports only its own
  views/styles, React's browser entry points and `shared.ts`; it cannot import Node, Electron,
  runtime/contracts packages or any `src` internals. Model and document text uses escaped React
  nodes, including the bounded M6 Markdown subset; raw HTML, links and remote images remain inert.
  Only host-checked bounded local PNG/JPEG bytes enter image previews. Content never grants authority.
- `shared.ts` is a data-only contract without external imports. `security.ts` is likewise pure;
  `wire.ts` can use only shared data and security validation. `preload.ts` imports only these
  three modules and Electron, exposing named methods rather than generic IPC or Node access.
- The trusted desktop host consists of `main.ts`, `bridge.ts`, `connection.ts`, `worker.ts`, `maintenance-worker.ts` and
  `host/`. It may use Node, its own host/shared/validation modules and the public `moyyi/runtime`
  and `moyyi/contracts` exports. Among these host files, only `main.ts` imports Electron. Relative imports into `src`
  or other repository code, unlisted desktop paths and undeclared application directories fail
  the boundary check. This does not create a second task engine or persisted authority model.
- The scanner covers static imports/re-exports, literal dynamic imports and `require` calls.
  Desktop production modules and pure core layers reject computed module paths. This is a
  dependency check, not an execution sandbox: native isolation, bridge validation and runtime
  policy still enforce behavior. Test-only Vitest and React server rendering do not widen
  production imports.

### Desktop M5 web and sources boundary

M5 keeps this client boundary: a named, doubly validated native-confirmed bridge command grants
temporary exact web origins. The host composes the existing WebPolicy with its local policy and
the existing network capability; no renderer networking is enabled. Recorded successful fetch
results supply a bounded source projection, independently of assistant claims. Settings and
persisted contracts are unchanged. See [ADR0043](decisions/0043-desktop-web-sources.md).

### Desktop M2 host boundary

[ADR 0038](decisions/0038-desktop-materials-and-reports.md) keeps the existing client/runtime
split. The renderer receives bounded settings/material/receipt projections. Its named bridge
can request configuration, native selection, receipt inspection and Finder reveal; it cannot
choose arbitrary absolute file paths or retrieve credentials. Main validates the owning frame,
input shape and current selection, including session/workspace checks after native dialogs.
The worker validates commands again and admits these operations only while idle.

`host/settings.ts` stores data-only preset/limit/credential-reference JSON under the protected
desktop directory with mode0600, a unique temporary file, fsync and rename. The existing runtime
closes before a connection changes, and the new runtime reopens the same SQLite store. The
fixed `native/keychain.swift` helper is compiled into the macOS bundle with Foundation/Security;
it is not a dynamic plugin or another TypeScript import permission. New credentials use distinct
UUID services, bounded stdin and native Keychain operations. Startup queries attributes only;
actual provider requests lazily read the selected credential. Secrets are absent from snapshots,
transcripts, argv and environment. Existing CLI Keychain items remain unchanged.

`host/materials.ts` inspects only bounded ordinary files inside the selected workspace. It
rejects protected paths, aliases/symlinks, hard links and changed identities; the selected paths,
sizes and hashes are checked again before a task starts. This selection does not add parser or
model authority. The seven existing document formats and parser isolation are reused.

`host/report-policy.ts` permits only `create` for one user-picked, missing JSON/Markdown/text/CSV
path, with approval for each prepared digest. Existing core write preparation, missing-file
preconditions, recording and postcheck remain authoritative. Clearing the target, changing the
connection or creating/reopening a session removes this write grant; active work must finish or
be cancelled first. Edit, undo, process and web capabilities remain unavailable in this slice.

`host/reports.ts` uses actual successful create receipts and a fresh guarded file read/hash match
to supply bounded UTF-8 plain text. Missing/changed/unavailable reports never become a successful
preview. Finder receives only the inspected receipt path and does not execute the file; its
invocation is not a confirmed user-visible selection. Historical receipts certify recorded
execution, not current bytes or answer correctness. No persisted core/session schema changes.

### Desktop M6 local materials and history

[ADR 0044](decisions/0044-desktop-material-library-and-history.md) adds trusted local management
without changing the agent loop, persisted transcript/effect format or layer import rules.
`shared.ts` remains an import-free DTO contract; renderer imports remain own modules, React and
shared data only. Named preload/main operations validate the owning frame, current session and
native-confirmed source/destination. Generic actions cannot grant arbitrary external path access.
Clipboard PNG and dropped disk files join the same native-confirmed import boundary, not renderer
filesystem or clipboard authority.

`host/managed-materials.ts` preserves bounded originals in the existing blob store and publishes
unique workspace copies. `src/store/materials.ts` owns assets, revisions, current selections and
conservative historical references. Importing adds no tool grant; documents/text still enter model
context through normal tools, policy and recording. Seven-format preview shows identity only;
PNG/JPEG preview is local and adds neither OCR nor model image input. Recycling preserves bytes
and references; purging requires an unreferenced recycled asset and verified managed copy and
never unlinks shared blobs. Optional housekeeping is off by default and only soft-recycles eligible
unreferenced materials after30 days.

The public runtime exposes host-only management ports alongside the unchanged client protocol:

| Port | Bounded operation and authority |
|---|---|
| `Runtime.sessions.list(query)` | Name/prompt-excerpt search, group/recycle filters and catalog pages; continuation binds query and catalog generation. |
| `Runtime.sessions.history(query)` / `readMessage(query)` | Older display pages and full-text chunks using stable session/entry identities. No reasoning, provider replay or request blobs; no workspace existence requirement. |
| `Runtime.sessions.update(update)` | Revision-checked title/group/pin/mute/recoverable removal. Removal refuses active work/unsettled effects/leases; removed sessions cannot start new work until restored. |
| `Runtime.materials` | Optional store-backed material list/get/find/create/activate, selection/reference attachment, read/recycle/restore/purge and housekeeping setting. No model-accessible tool or implicit permission grant. |

These APIs share runtime idle admission, close lifecycle and the single store writer. Sequential
calls release admission before resolving; concurrent management/run/reload requests cannot bypass
it. Existing CLI session commands retain their interface. Metadata is local organization, not
model context or authority. Missing-workspace and recycled sessions remain inspectable read-only;
new work still requires the actual workspace, active session and current permissions.

SQLite schema3 adds session metadata and material assets/references/selections/settings. Validated
schema1/2 stores migrate transactionally; transcript/effect format1 and existing entries are unchanged.
Backup traverses material blob references as well as transcript/snapshot references, including
recycled originals. Restore upgrades a private verified copy. Software rollback requires the old
package's declared schema to match current data, otherwise the pre-upgrade app and data backup must
be used together after rescuing current state; no deletion or implicit downgrade makes it fit.

`RichMessage.tsx` renders a bounded Markdown subset with escaped React nodes. `host/image-preview.ts`
checks PNG/JPEG headers, encoded size and dimensions before exposing a data-image DTO; the renderer
validates the DTO and handles decode failure. HTML, navigation and remote images remain inert.
`host/save-result.ts` freshly checks receipt-selected bytes/hash and uses exclusive creation at a
native-selected destination; cancel and existing-file refusal do not overwrite user files.
See [desktop use and limits](desktop.md#materials-previews-and-complete-history-m6-candidate).
This is **candidate implemented, acceptance pending**, not installed or semantic acceptance.

### Desktop M3 controlled workflows

[ADR 0039](decisions/0039-desktop-controlled-workflows.md) extends this same host with two
ephemeral grants: snapshot-backed file writes and read-only-workspace Node checks. Both start
disabled. A dedicated main-process bridge confirms the selected workspace and revalidates the
session after the native confirmation. The worker admits a grant change only while idle, closes
the old runtime and reopens the same store. New/reopened sessions and model configuration reset
the grants; changing grants clears the report target, and selecting a report target clears the
broader grants. Generic renderer actions cannot bypass this native permission entry.

The host uses the existing public runtime policies, file tools and process isolation. The only
added runtime export is the existing `discoverNodeToolchain` implementation; no new core port or
effect execution API is introduced. File edits/undo and commands still require their own exact
prepared-action approval. The check grant selects the supported Node toolchain, a read-only
workspace and no network; it does not grant command-based editing or dependency installation.

The host projects the existing `session.results` page into bounded effect rows, retaining failed,
cancelled and unknown states as well as matched file/process receipts. Inspection is a fresh
guarded file/hash comparison against `afterHash`; expected absence is distinct from a missing
expected file. It verifies bytes at inspection time, not file mode, undo readiness or semantic
correctness. The existing undo tool separately rechecks hash/mode before restoring a snapshot.

The renderer reuses its snapshot receiver, synchronous action gate and exact approval identity.
Long-list folding is a narrow OpenBot view adaptation; host state determines all status labels.
Preparing an undo or check only inserts an editable user draft, never dispatches an effect or
starts a model call. The user must send it through the ordinary budgeted loop. Reopening history
does not replay work or approvals. An interrupted started process can retain an unknown effect
and workspace lease: read-only inspection remains available, while later mutations may be blocked
even after a new write grant. Inspection does not clear the lease; no force-unlock API is added.
A worker failure closes the bridge view and clears displayed
grants, target and inspections; old records remain evidence, not active authority.

## Data model

Three kinds of authoritative records, committed together in one SQLite transaction:

1. **Transcript**: immutable entries forming a tree through `parentId`. Compactions are entries;
   originals are never deleted. Each assistant message references the exact request the model
   saw, stored as one content-addressed blob per rendered message, so storage grows linearly.
2. **Effect journal**: one record per tool action, through the states in
   [effects.ts](../src/contracts/persisted/effects.ts).
3. **State tables**: session metadata, current run, heads.

Large payloads live in the blob store. Streaming deltas are not persisted; completed parts are,
and an interrupted assistant message is persisted with `stopReason: "interrupted"`.
Committed transcript, effect and state records use WAL + `synchronous=FULL` by default, under
[ADR 0002](decisions/0002-storage.md). Both store durability intent labels map to FULL in v1.

## Model client contract

One request per call. Every stream ends with exactly one terminal event (`completed` or
`error`). Provider, network and cancellation failures are `error` events, never exceptions; an
exception is a programming error. Every provider runs its recorded fixtures through
`checkModelStream`.

[ADR 0021](decisions/0021-request-budget-closeout.md) reserves the final permitted conversation
request for an answer without increasing the request quota. Core records a countdown notice for
each attempt and sets optional `ModelRequest.toolChoice: "none"` on the last one, retaining tool
definitions and history. Providers disable new calls and core independently refuses any violating
call before preparation/execution. An absent, truncated or tool-only final answer is not completed.

[ADR 0042](decisions/0042-direct-evidence-answer.md) adds an experimental, default-off
`evidenceAnswer` option for fresh self-contained sessions. Core can transition once to an answer
at a completed draft, last request or absolute one-third investigation deadline. New tool
admissions stop at that deadline; started effects settle under the original run signal. The old
stream and recorder must close within a one-second cleanup cap before final inference. Errors,
user cancellation and the original global deadline remain terminal. Context projects the original
user input and all paired observations without prior assistant interpretations. Context keeps
all sections/effects and refuses oversized inputs. Existing records preserve the original
history and the `moyyi-evidence-answer-v1` request. No extra budget, final tool execution,
steering, automatic retry, implicit compaction or factual-success judgement is introduced.
Budget notices extend the current user turn in context; they do not rewrite the system or old
prefixes. The exact request, including tool choice, is recorded without a persisted schema change.

[ADR 0034](decisions/0034-incomplete-response-outcomes.md) applies response completeness to
every attempt. Token truncation exhausts `model_output_tokens`, including the final request;
before the final request, an empty answer or unsupported terminal fails the run. Partial content
and usage remain recorded, and no automatic continuation is added. Other final-request outcomes
stay unchanged. The CLI distinguishes a partial answer from no answer and displays known final
output/reasoning counts without exposing reasoning content.
Protocol completion does not certify factual correctness or independently checked task success.

The DeepSeek adapter accepts a documented text/reasoning/function subset and delegates fixed-origin
HTTP and credentials to runtime. Context includes the persisted assistant stop reason in the
nonpersisted model port, so partial responses cannot masquerade as complete history. All actual
visible reasoning is preserved, but complete turns need not produce it. Validated commentary and
final-answer annotations retain their text in the plaintext profile; response terminals govern tools.
Optional model recording/replay lives in runtime; it captures canonical requests and common events,
not HTTP credentials. It requires a sequential stream and exact request/profile match, with no live
fallback. See [deepseek.md](deepseek.md) and [ADR 0010](decisions/0010-deepseek-transport-and-recording.md).

## Effect pipeline

```
parse args → schema validation → policy (prepare) → prepare (read-only)
  → journal: intended → policy (execute) → approval bound to digest when asked
  → journal: approved → recheck preconditions → journal: started (durable before effect)
  → execute → journal: succeeded | failed → tool_result
```

- Tool calls run only after the whole assistant message has completed.
- Approval binds to the `ActionDigest`. If preconditions changed after approval, the record returns
  to `awaiting_approval`.
- `prepare` reads state, so it needs read permission even for a preview.

## Recovery

- No exactly-once promise: file effects and database commits cannot share one transaction.
- At startup every non-terminal effect is reconciled. `started` becomes `unknown` unless the
  tool's `reconcile` finds evidence. Unknown effects are never replayed automatically.
- Every `tool_call` gets a `tool_result`; interrupted ones get `cancelled` or `unknown`, and the
  model is told to verify before retrying.
- Cancelling a run neither discards the session nor undoes completed effects. Undo is a separate
  user action backed by workspace snapshots.

## Concurrency

One writer process per data directory, enforced with an OS file lock. Accepted in
[ADR 0002](decisions/0002-storage.md): one active run per session and a write lease per
workspace. The merged store and core enforce these constraints. The runtime composes
`AgentCore` with the SQLite store, context, policy, validator and precondition ports; see
[core.md](core.md) for the executable core entry point and [files.md](files.md) for runtime-confined
read capabilities. The executor owns capability lifetime and permission checks; runtime performs
filesystem I/O. File tools cannot access Node filesystem APIs directly.

## Security decision

[ADR 0006](decisions/0006-security-boundaries.md) defines workspace permissions, separate
process containment and network authority, credential handling and local session privacy.
Application-level session encryption is not a first-release prerequisite. The
[threat model](threat-model.md) records assumptions and remaining validation.

## Out of scope for the first release

Browser automation, MCP, long-term memory, sub-agents, automation, GUI. Each has a place above.

## Controlled writes (merged phase 2)

The runtime supplies `ToolContext.writes` only to authorized workspace-write tools. Preparation
can inspect; apply is single-use and bound to the executor-approved payload after durable start.
SQLite schema 2 adds immutable touched-file snapshots, with blobs included in backups; persisted
transcript/effect v1 is unchanged. Undo is a new approved effect and refuses later file changes.
Recovery only inspects recorded pre/post-state and never replays a mutation. See
[ADR 0012](decisions/0012-controlled-workspace-writes.md) and [usage](writes.md).

[ADR 0035](decisions/0035-verified-write-observations.md) returns the existing verified post-write
observation through the same receipt only when independently read-authorized. Runtime supplies
actual bytes and rechecks disclosure after cleanup; fs fits bounded text into one JSON receipt.
No new I/O, core extension point or persisted schema is introduced. Denied reads withhold the
optional body without changing a successful write; content truth remains a separate task check.

## Sandboxed commands (merged phase 3)

[ADR 0013](decisions/0013-native-process-sandbox.md) records accepted D6: native OS sandbox by
default, Docker optional. `ToolContext.processes` adds a per-invocation process capability only
for process-effect tools. `shell` prepares an exact command/cwd/timeout; runtime executes only
that approved payload after the existing core's lease and durable-start barrier. A separate
host grant selects exact roots, with clean environment and mandatory native confinement.

Runtime owns Seatbelt/bubblewrap adaptation, bounded output, deadline and process-group cleanup.
Non-exited/uncertain results become unknown and stop the run; recovery never reruns commands.
macOS detached descendants and host-SIGKILL cleanup limits are explicit. Docker is a future
optional adapter, not an implicit dependency or fallback. See [usage and limits](shell.md).

## Long sessions and recovery

Phase 4 adds optional `ContextBuilder.planCompaction` and `session.compact` to the existing
ports/protocol. The context layer chooses a safe settled prefix and renders an ordinary bounded
model request; core runs it without tools under normal lifecycle limits. An immutable compaction
entry and its selected head are committed together with a sibling request/usage audit entry.
Only the selected path enters subsequent model context. The replaced span's replay is omitted;
untouched messages retain provenance, and unsettled effects stay independently visible.

Stable section/tool order preserves prefix reuse opportunities. Context reports expose the
conservative budget and represented entry IDs. No live cache-hit rate is inferred. Recovery's
run status, notice/result pairing and lease decision commit together, so a crash during recovery
can be retried. See [ADR 0014](decisions/0014-recovery-and-compaction.md) and
[usage](long-sessions.md); persisted v1 and layer import boundaries are unchanged.

## Anthropic and tool network authority (merged phase 5)

[ADR 0015](decisions/0015-anthropic-and-web.md) adds a second provider through the existing model
port. Anthropic-specific prefix/account replay bindings stay opaque to the core, in the existing
D2 envelope. Direct HTTP and credentials remain runtime responsibilities. No shared persisted
format or dependency changes are required.

`ToolContext.web` is a separate port for external tools. The executor supplies it only to external
invocations and withholds their local file capabilities. Runtime enforces exact-origin grants,
no-I/O preparation, frozen action/digest/run binding, durable-start ordering and single execution.
The default `WebPolicy` asks before network execution; installed policy rules can only restrict it.
Production HTTPS validates all A records then pins the connection, verifies TLS, refuses redirects
and bounds output/time. Search uses an explicitly configured SearXNG endpoint. Page content and
search links are untrusted data without authority. Unknown external effects are never replayed.
See [web usage and limits](web.md) and [Anthropic usage](anthropic.md).

## Local candidate packaging (merged phase 6)

[ADR 0016](decisions/0016-local-installable-candidate.md) keeps the existing layers and compiles
production ESM/declarations into a private npm tarball. `moyyi/runtime` exports the composition
root and existing trusted-host configuration helpers; `moyyi/contracts` exports commands, events
and plugin contracts. No internal wildcard entry or new network protocol is introduced. Installed
clients use the same send/subscribe/idle/close lifecycle as the CLI.

A complete package inventory, isolated tarball installation and actual CLI/PTY/client/type checks
are required in CI. The installed process has no source checkout or compiler dependency. This is
an unpublished development candidate with explicit platform and live-service gaps; see
[installation](installation.md) and [client protocol](client-protocol.md).

## Document reading

[ADR 0028](decisions/0028-bounded-document-reading.md) adds an execute-only read capability
for a fixed, native-sandboxed byte-to-text parser. The documents plugin validates arguments and
presents evidence; runtime owns the guarded complete snapshot, hash, parser process and cleanup.
The parser gets no workspace or network grant. Existing read policy and `--approve-reads` apply;
`documents:false` removes the tool. Persisted contracts, generic shell permissions and daily write
grants are unchanged. [Usage and coverage](documents.md) distinguish extracted positions, source
hash, output truncation and incomplete extraction.
