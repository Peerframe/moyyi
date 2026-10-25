# fs

Read-only workspace tools: `read`, `list`, and `search`. The plugin imports contracts only;
every filesystem operation goes through the runtime-owned `ToolContext.files` capability.
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

Preparation only validates and snapshots arguments. It does not read file contents or list a
directory, and adds no world-state preconditions. Execution receives a fresh capability and
rechecks cancellation after awaiting it. The host's path refusals fail the operation directly;
they cannot become a request to approve a stale precondition.
All tools declare a `read` effect with no applicable reversal or reconciliation operation.

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
There is no write, shell, arbitrary network or real-model capability in this plugin.

Tests beside this file use mock capabilities to check delegation, missing/denied capabilities,
cancellation, closed argument schemas and bounded JSON output. Actual filesystem confinement,
ignore behavior, revocation and runtime integration are checked in the host's tests.
