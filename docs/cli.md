# Interactive CLI and development reload

The CLI connects the existing agent runtime to a terminal: continuous sessions, streamed text,
explicit approvals, cancellation, steering and history resume. The default policy remains read-only.
DeepSeek and opt-in Anthropic adapters are available. A bounded DeepSeek file-read task has passed
live acceptance; broader task quality and Anthropic live acceptance remain unverified.

Default working guidance and the selected workspace's root `AGENTS.md` now enter model context.
Automatic reads honor the read policy and a 16 KiB complete-file limit; nested instructions require
ordinary explicit reads. This discovers text, never executable workspace configuration. See
[project instructions and opt-out](instructions.md).

## Try the offline client

```sh
npm run moyyi -- --demo -C /absolute/workspace --data /absolute/private/demo-data
```

Use a disposable workspace with a `README.md`. This is a finite script (32 read/answer pairs),
not an LLM: it attempts to read `README.md` and reports that the result is recorded, regardless of
the supplied task. It is useful for checking the client and real file-tool path without credentials.
For a single prompt, append text; piped input is treated as one bounded prompt:

```sh
npm run moyyi -- --demo -C /absolute/workspace --data /absolute/private/demo-data "Inspect the README"
printf 'Inspect the README\n' | npm run moyyi -- --demo -C /absolute/workspace --data /absolute/private/demo-data
```

No prompt on a terminal opens interactive mode. `--interactive` keeps a terminal open after an
initial prompt. Interactive mode requires a real TTY; pipes use one-shot mode. Input is limited to
64 KiB. `--help` and `--version` require neither a model nor a data directory.

## Connect an existing trusted host

```sh
npm run moyyi -- --host /absolute/private/moyyi-host.mjs -C /absolute/workspace
```

The host module must explicitly export `RuntimeOptions` and select a model. For DeepSeek it can
reuse an existing trusted credential provider:

```js
import { getDeepSeekKey } from "/absolute/path/to/your/credential-provider.mjs";

export default {
  model: { provider: "deepseek", model: "deepseek-flash" },
  dataDirectory: "/absolute/private/moyyi-data",
  deepseek: { getApiKey: getDeepSeekKey },
};
```

The imported credential provider in this example must already exist in your host; it is not a
new built-in keychain adapter. `getApiKey` is the explicit callback from batch 6. CLI does not
search `.env`, environment credentials, project config or the filesystem for keys, and does not
save a key. Never place a key in source, arguments or a PR. Loading a host/plugin module executes
trusted local code with the process's permissions; it is not sandboxed configuration data.

`--data DIR` overrides a host data directory, or defaults to `~/.moyyi/data` when neither is set.
It cannot override an injected store. Stores, transcripts and blobs may contain private content;
keep them outside a repository. The runtime protects its store from ordinary file tools. See
[DeepSeek configuration and live smoke](deepseek.md) or [Anthropic configuration](anthropic.md)
for supported profiles and acceptance gaps. Tool networking is separate: [web grants](web.md)
describe explicit origins, optional search and interactive approval.

## Enable capabilities for this workspace

Startup flags are explicit, temporary owner grants. With no flags, the host's settings remain
unchanged. They never load project configuration, change a stored session's authority, or remove
per-effect approval. For a normally read-only host:

```sh
moyyi --host /absolute/private/moyyi-host.mjs -C /absolute/workspace \
  --allow-write --allow-shell --shell-toolchain node --max-requests 8
```

- `--allow-write` enables snapshot-backed create/edit/undo in the selected canonical workspace.
- `--allow-shell` independently enables approved commands with a **read-only workspace** and no
  network. A private scratch directory remains writable. `--allow-write` does not make commands
  writable; cache/coverage/build outputs in the project can fail. Existing explicit host process
  grants retain their documented default behavior; see [shell](shell.md).
- `--shell-toolchain node` requires `--allow-shell`. It selects the current Node executable and
  its exact startup libraries/aliases through a bounded clean probe. It does not grant an entire
  installation tree, npm/global packages, external dependency caches or arbitrary native addons.
- `--max-requests N` explicitly changes only the per-turn model request ceiling (1–128), including
  the final no-tool answer. Other host limits and retry settings remain unchanged. It is not a
  monetary cap or a change to evaluation budgets.

To read a specific website, add `--web-origin https://www.rfc-editor.org`; repeat the flag for
other origins. Paths, credentials, query strings and fragments are rejected. Each fetch asks for
approval; DNS/public-address/TLS checks still apply and linked sites receive no implicit grant.
`--web-dns cloudflare-doh` explicitly sends authorized hostnames to the fixed Cloudflare resolver;
`system` remains the default. DNS selection requires an origin grant. See [web](web.md).

CLI capability flags refuse conflicts with the corresponding existing host capability or any
custom host policy. Configure one authority source; no silent policy replacement. `--approve-reads`
can accompany CLI grants and still covers document reads. Noninteractive approvals remain denied.
Capabilities are limited to the selected workspace/origins even if another session is resumed.
The offline `--demo` rejects these daily capability and budget options.

## Session controls

| Input | Behavior |
|---|---|
| Ordinary text while idle | Start a run in the selected session |
| Ordinary text while running | Persist steering for the active run; it does not cancel and silently restart |
| Ctrl-C / `/cancel` | Cancel the active run and preserve partial content/results; Ctrl-C when idle exits |
| `/new` | Create a new session in the configured workspace, only while idle |
| `/resume SESSION_ID` / `--session SESSION_ID` | Load persisted history; requires the matching data directory |
| `/sessions [PAGE]` | List recorded sessions in this private store across workspaces; idle only, 20 per page |
| `/results [SESSION_ID [PAGE]]` | Inspect recorded effects and matching receipts; defaults to the selected session, idle only |
| `/approve EFFECT_ID` / `/deny EFFECT_ID` | Respond only to a currently displayed approval using its exact digest |
| `/reload NAME` | Reload an explicitly configured development plugin while idle |
| `/compact` | Summarize older turns with one request to the selected model; idle only; cancellable |
| `/help` | Show controls |
| `/exit` / terminal EOF | Cancel any active run, wait for cleanup and close storage |

The session ID is displayed when created or loaded. Use `/sessions` to find it after restarting;
the list shows the workspace, last recorded activity and an excerpt of the last user prompt.
Empty sessions have no invented activity time. `/sessions 2` shows the next page. These are local
views of the selected private data directory; viewing or restoring history makes no model request.
Failed/partial DeepSeek history may be rejected by its
strict continuation profile; use `/new` for a fresh conversation rather than inventing reasoning.

Use `/results SESSION_ID` before resuming, or `/results` for the current session, to inspect
recorded effects. Matching file receipts show the path and snapshot ID; process receipts show
exit/termination status. These are historical observations: a file may have changed or been
undone since then, and exit code zero does not prove a correct check. Missing/ambiguous results
remain without a matched receipt. `/results SESSION_ID 2` shows the next page; CLI pages are
1–501. Inspection does not change your selected session, replay actions or restore old approvals.
To continue, use `/resume SESSION_ID`. Writes and commands still require the current host's
explicit grants; restart with the appropriate workspace and startup flags when necessary.

Add `--approve-reads` to require execution approval for read/list/search/document tools. It cannot replace a
custom host policy or authorize a forbidden effect. Multiple approvals have separate IDs/digests;
a stale response is rejected and never retried automatically. In one-shot mode approvals are
explicitly denied, so unattended input cannot authorize them or leave the process waiting forever.

Assistant text streams as it arrives and is not printed twice when its persisted message arrives.
Matching current effect/tool results also display bounded file paths/snapshot IDs and command exit
status. Arbitrary assistant prose, read content and ordinary history replay are not promoted to
receipts. The explicit `/results` view independently matches persisted journal and tool records.
Ask the agent to undo a displayed snapshot; normal approval and conflict checks still
apply. Reasoning is retained by the runtime but not printed by this client. Output is marked by source;
control characters and bidirectional formatting are escaped. This is a readline terminal client,
not a full-screen TUI. No command is executed from model/file content.

`run | completed` means a complete response was received, not that its facts or task results
were independently verified. A truncated response is retained but ends with a nonzero one-shot
exit, even when requests remain: `budget exhausted: model_output_tokens`. Empty or otherwise
incomplete answers similarly fail without an automatic retry. The final reserved request keeps
the existing `model_requests` exhaustion diagnosis. A complete refusal or an honest partial-work
report can still complete the response protocol; inspect its content and actual results.

## Explicit development plugins

```sh
npm run moyyi -- --demo -C /absolute/workspace --data /absolute/private/demo-data \
  --dev --dev-plugin project-note=/absolute/plugins/project-note.mjs
```

An entry is a default `Plugin` export with the configured name, for example:

```js
export default {
  name: "project-note",
  apiVersion: 1,
  setup(host) {
    host.registerContextSource({
      id: "project-note",
      collect() {
        return [{ id: "project-note", stability: "static",
          content: [{ type: "text", text: "A development context note." }] }];
      },
    });
  },
};
```

Only `.mjs` or `.mts` ESM entries are accepted for development. Repeat `--dev-plugin` for multiple
unique names; startup/built-in names cannot be replaced. No plugin is discovered automatically.
Interactive mode watches their parent directories. An edit during a run waits for idle before
requesting reload. A manual `/reload` during a run is rejected without unloading anything.
A concurrent start/reload is admitted atomically; cancellation and approval remain available while
an active run prevents reload. Watch errors report the manual `/reload NAME` fallback.

At an accepted reload the old plugin is unloaded first. Import/setup/model initialization failure
leaves it unloaded and reports failure; the CLI does not pretend the old version remains ready.
If the selected provider disappears, new runs are blocked until it is repaired. The same store,
session and policy remain, and an unrelated provider's client state is preserved.

**Limit:** only the explicit entry gets a fresh module URL. Changes in its imported dependencies
need a restart or a rebuilt single-file entry. Old modules remain cached, so restart periodically.
Development reload is incompatible with model recording/replay; those need a stable configuration.
It is a development convenience, not a production upgrade mechanism or plugin sandbox.

## Reproducible verification

```sh
npm run check
npm run build
node dist/cli/main.js --help
python3 scripts/verify-cli-pty.py
python3 scripts/verify-cli-pty.py --entry dist/cli/main.js
```

The Python 3 script is a POSIX terminal smoke. Phase 6 also runs it against the installed
candidate in CI; Python is a verification prerequisite, not a product runtime dependency. It creates
synthetic files and private temporary stores, drives real approvals/Ctrl-C/steering/resume/reload/EOF,
then cleans up. It makes no model call and needs no credential. Unit/integration tests also run the
source executable as a child process. These are execution and UI evidence, not model-quality scores.

For a manual check, run the offline client with `--approve-reads`, approve one displayed ID, then
start another request, type steering and press Ctrl-C. Resume the printed session ID. In development
mode break and repair the explicit plugin file, observe failed then loaded status, and try `/reload`
while a run is awaiting approval. Exit with Ctrl-D and reopen the same store to confirm lock release.

The merged batch 7 record is [here](tasks/2026-10-25-batch-7-cli.md). Phase 2 adds
[controlled writes](writes.md) through explicit host configuration, using the same displayed-digest
approvals. Dependency-graph reload and live model evaluation remain outside scope.
Phases 4–5 are merged. The current handoff is [phase 6](tasks/2026-10-25-phase-6-candidate.md);
[installation](installation.md) covers local candidate packages and their acceptance boundary.

## Native command opt-in

An explicit host can set `workspaceProcesses: { roots: [absoluteProject], approval: "ask" }`.
The CLI displays exact command approvals through the existing protocol and Ctrl-C cancels the
owned process group. File-write grants alone do not grant shell access. The default demo remains
read-only. See [shell configuration and platform limits](shell.md); unknown interrupted command
effects are not retried automatically and may require manual workspace inspection.

## Explicit conversation compaction

`/compact` retains recent turns and summarizes an eligible older prefix with the selected model.
It is a model call, can incur the configured provider's cost, and is never automatic. `/cancel`
stops it. Originals remain available; the CLI labels summary-request audit records separately
from normal answers. See [long-session behavior and limits](long-sessions.md). The finite offline
`--demo` script does not generate summaries; `npm run eval:long-sessions` checks the feature with
purpose-built synthetic responses.


When a model reaches its output limit, the CLI marks any text as partial or reports that no
answer was produced. If final usage is available, it shows output tokens and the reasoning tokens
included in that total, without displaying reasoning content. This is a per-response output
limit, even on the final allowed request; allowing more requests does not enlarge it. The run
still exits nonzero in one-shot mode and does not continue automatically. Original partial
content and usage remain in session history.
