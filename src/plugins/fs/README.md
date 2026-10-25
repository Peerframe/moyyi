# fs

Workspace tools: `read`, `list`, `search`, `create`, `edit`, and `undo`. Writes require host opt-in. The plugin imports contracts only;
every filesystem operation goes through runtime-owned `ToolContext.files` or `ToolContext.writes`.
Missing capabilities, revoked access, cancellation and host refusals produce explicit failures.
There is no direct-I/O fallback and no plugin configuration.

| Tool | Arguments | Result |
|---|---|---|
| `read` | Required workspace-relative `path`; optional `maxBytes` (1–65,536) | `path`, UTF-8 `text`, `bytesRead`, `truncated` |
| `list` | `path` defaults to `.`; optional `maxEntries` (1–200) | `path`, typed `entries`, `skippedEntries`, `truncated` |
| `search` | Required single-line literal `query` (1–256 characters); `path` defaults to `.`; optional `maxMatches` (1–100), `caseSensitive` (default `true`) | `path`, `matches` with file/line/text, `skippedFiles`, `truncated` |

Paths cannot be absolute, contain parent traversal, backslashes or NUL. Requests contain no
permission override, alternate workspace, ignore bypass, regex or process flag. The host also
validates paths at the actual operation; plugin validation is not the security boundary.

Read-tool preparation only validates and snapshots arguments. It does not read file contents or list a
directory, and adds no world-state preconditions. Execution receives a fresh capability and
rechecks cancellation after awaiting it. The host's path refusals fail the operation directly;
they cannot become a request to approve a stale precondition.
The three read tools declare a `read` effect with no reversal or reconciliation operation.

Results are JSON inside the tool's text content. Limits are upper bounds: the host and the
serialized output budget can reduce them further. Defaults request at most 16 KiB for reads,
50 list entries or 20 search matches, reduced for the available output budget. Oversized
responses keep valid JSON, shorten their text/results and set `truncated: true`. A very small
budget can return only `{"truncated":true}`. A truncated or partially skipped search is not
proof that the rest of the workspace contains no matches. Failures remain failed outcomes.

The host rejects binary/non-UTF-8 reads, protected paths and escaping symlinks. Explicit reads
and directory listings may resolve an internal symlink; recursive search skips symlinks and
honors scoped `.gitignore` rules. Ignore compatibility limits and the residual filesystem race
assumptions are documented in [ADR 0009](../../../docs/decisions/0009-workspace-files.md).
No shell, arbitrary network or real-model capability is provided.

`create` takes `path` and `text`; `edit` takes `path`, `oldText` and `newText` with exactly one
literal match; `undo` takes a prior `snapshotId`. They declare snapshot-backed workspace writes,
prepare exact before/after previews and hash preconditions, and call only the runtime-bound
single-use apply capability. Outcomes include a snapshot ID. Execution exceptions propagate as
uncertain effects. See [controlled writes](../../../docs/writes.md) for opt-in, recovery and limits.

Tests beside this file use mock capabilities to check delegation, missing/denied capabilities,
cancellation, closed argument schemas and bounded JSON output. Actual filesystem confinement,
ignore behavior, revocation and runtime integration are checked in the host's tests.
