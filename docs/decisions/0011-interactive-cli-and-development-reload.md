# 0011: Interactive CLI and idle-only development reload

Status: accepted implementation of batch 7 (2026-10-25); real-model acceptance remains pending

## Decision

Use Node's existing readline and filesystem APIs for a thin terminal client. Keep session, run,
steering, cancellation and digest-bound approval decisions in the runtime/core protocol. Add only
`plugin.reload` and `plugin.status` to the nonpersisted protocol for explicit development entries.
No terminal UI framework, file-watcher dependency, new credential backend or core replacement is
needed. CLI rendering escapes control/bidirectional characters and prefixes untrusted output by
source; printed model/file content cannot become a terminal control or approval command.

A full-screen terminal framework and an additional watcher package would add packaging/lifecycle
cost without filling a current gap. Native readline supports line input, SIGINT and close; the
existing protocol already supports the execution controls. A dedicated dependency may be reviewed
later if terminal layout or dependency-graph reload becomes a concrete requirement. No new package
version is selected and no OpenBot or other upstream source is copied or substantially adapted.

## Targeted evidence

Official Node documentation reviewed on 2026-10-25:

- [Readline](https://nodejs.org/api/readline.html): line, SIGINT and close events; close may still
  be followed by buffered line events, so the controller rejects input during shutdown.
- [ESM URLs](https://nodejs.org/api/esm.html#urls): differing query/fragment URLs create distinct
  module cache entries. This refreshes an entry, not its static dependencies.
- [fs.watch](https://nodejs.org/api/fs.html#fswatchfilename-options-listener): platform/inode
  behavior and missing filenames. Watch explicit entry parent directories, debounce notifications
  and compare file fingerprints to handle atomic editor saves and avoid phantom reloads.

The rolling pages identified Node v26.12.1 when reviewed; fixed v26.0.0 pages were unavailable
through the research tool. Execution evidence uses the repository's actual Node 26.0.0 on macOS
and the existing Node 26 CI lane. We do not infer Windows or network-filesystem watch support.

## Host configuration and authority

`--demo` uses the existing scripted provider with a bounded offline read-only demonstration.
`--host FILE` evaluates one explicitly trusted local module exporting `RuntimeOptions`; it reuses
batch 6's credential callback and connection boundary. There is no automatic workspace config,
plugin discovery, environment-key fallback or new keychain selection. A host module is trusted
installed code and can execute arbitrary code; this is not a data-only configuration sandbox.
Only explicitly selected development modules are watched. Development entries are `.mjs`/`.mts`
and must export the exact configured plugin name. CLI private data defaults to `~/.moyyi/data`;
`--data` or trusted host settings select an alternative. No raw key is stored by the CLI.

The default policy remains read-only. `--approve-reads` makes the existing read/list/search
execution require a displayed effect ID and digest. It cannot override a custom host policy.
Noninteractive mode denies approval requests. The interface never offers automatic approval,
shell commands or write tools. Real credential-store integration remains an owner/host concern,
not an implicit fallback decision in this batch.

## Reload lifecycle

The registry's unload/load alone is insufficient: `AgentCore` holds a tool snapshot and selected
model client. At an idle reload, runtime synchronously closes admission, waits for the old core to
finish, unloads the old plugin, imports and atomically sets up the new plugin, then rebuilds core
bindings against the same store/session/policy. An unrelated provider client is retained; reloading
its owner creates a fresh client even if a cached dependency reuses the same provider object.
Recovery runs once, not on each reload. Active/start-pending commands cause a reload rejection;
a manual reload can be retried and the CLI watcher waits for idle before submitting.

Import, setup or provider initialization failure leaves the affected plugin unloaded and reports
fixed stage-specific diagnostics. Raw exceptions can contain secrets and are not displayed. A
missing selected provider prevents new runs and can be repaired by a later reload. Shutdown stops
watching and new imports; a previously started import is awaited and its result discarded if closing.

Development reload and model recording/replay are explicitly incompatible. This keeps one capture
bound to one stable adapter/plugin configuration. Production uses fixed startup plugins. Reload
creates fresh entry module URLs and retains old module cache entries; it is development-only.
Static imported dependencies require a process restart, or a single pre-bundled entry. `.js`/`.ts`
entries are rejected for development because ambiguous CommonJS caching can pretend to reload.

## Evidence and limits

Protocol tests cover approvals, stale digests, streaming, cancellation, steering, EOF and resume.
Real SQLite/runtime tests cover active-run rejection, atomic admission, failed reload, selected
provider repair, tool replacement and shutdown. Native Node module tests verify entry cache bypass;
watch tests cover atomic replacement. Source and compiled CLI plus a real POSIX PTY smoke are
verified offline. See [batch 7 handoff](../tasks/2026-10-25-batch-7-cli.md) for executed results.

This provides an interactive read-only client, not real-agent quality evidence. Owner-run DeepSeek
acceptance, pass@1/pass^k and charges remain unverified. Phase 2, write/shell authority, a GUI and
model training are not implemented or authorized here.
