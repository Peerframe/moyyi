# fs

Workspace tools: `read`, `list`, `search`, `create`, `edit`, and `undo`. Writes require host opt-in. The plugin imports contracts only;
every filesystem operation goes through runtime-owned `ToolContext.files` or `ToolContext.writes`.
Missing capabilities, revoked access, cancellation and host refusals produce explicit failures.
There is no direct-I/O fallback and no plugin configuration.

| Tool | Arguments | Result |
|---|---|---|
| `read` | Required workspace-relative `path`; optional `maxBytes` (1–65,536), `startLine` (1–1,000,000), `maxLines` (1–1,000) | `path`, UTF-8 `text`, `bytesRead`, `truncated`; range reads also have `lineRange` |
| `list` | `path` defaults to `.`; optional `maxEntries` (1–200) | `path`, typed `entries`, `skippedEntries`, `truncated` |
| `search` | Required single-line literal `query` (1–256 characters); existing directory `path` defaults to `.`; optional `maxMatches` (1–100), `caseSensitive` (default `true`), `contextLines` (0–20 per side, default 8) | `path`, `matches` with file/line/text, optional merged `context` windows, `skippedFiles`, `truncated` |

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

Search context uses the same scanned file version as its hits. Each window has `path`, 1-based
`startLine`/`endLine`, exact `text`, and `complete`. Overlapping/adjacent windows merge, without
semantic ranking or automatic exclusion of tests. Runtime caps combined context text at 64 KiB;
the existing output budget may reduce it further. Context is clipped on whole lines; incomplete
scan tails are never presented as complete lines. `complete` means nearby lines were returned,
not that a whole function or dataflow was verified. Output serialization drops whole windows
instead of retaining false endpoints. Omitted context sets `truncated`; use `read` to inspect gaps.
`contextLines: 0` disables windows and preserves hit-only navigation. The capability's default
remains 0; the model-facing tool explicitly selects 8. See [ADR 0024](../../../docs/decisions/0024-search-source-context.md).

Without line arguments, `read` retains its prefix behavior. Supplying either `startLine` or
`maxLines` selects a range, defaulting the missing option to line 1 or 200 lines. For example,
after a search hit on line 420, read `{"path":"src/example.ts","startLine":400,"maxLines":60}`
to inspect the surrounding implementation. `search` accepts one literal, so `a|b` is the exact
three-character string, not two alternative patterns; its path must be a directory, not a file.

Range selection scans the complete file through the same guarded read path, up to 1 MiB;
larger, binary or invalid UTF-8 files fail rather than return uncertain line positions. Lines
are 1-based and delimited by LF, with original CRLF bytes preserved and no phantom empty line
after a final LF. EOF or an out-of-range start returns the available text, possibly empty.
`lineRange.startLine` is the requested start; `endLine` is the last line represented in the
returned text, or `null` for empty text. `complete` is false when the byte limit cuts the selected
range; true means all selected lines available before EOF were returned. A partial last line
still counts toward `endLine`; inspect `complete` before treating it as a whole line.
`bytesRead` counts the UTF-8 bytes returned by the host for a range, not its full-file scan.
`truncated` is true whenever any file content was omitted before or after the range, or by the
byte limit. Thus `lineRange.complete: true` does not imply the entire file was read into the
result. Further serialized-output clipping drops `lineRange` instead of retaining incorrect
endpoints; a minimal result can still be only `{"truncated":true}`.

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
