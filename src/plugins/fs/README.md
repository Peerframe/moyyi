# fs

Workspace tools: `read`, `list`, `search`, `create`, `edit`, and `undo`. Writes require host opt-in. The plugin imports contracts only;
every filesystem operation goes through runtime-owned `ToolContext.files` or `ToolContext.writes`.
Missing capabilities, revoked access, cancellation and host refusals produce explicit failures.
There is no direct-I/O fallback and no plugin configuration.

| Tool | Arguments | Result |
|---|---|---|
| `read` | Required workspace-relative `path`; optional `maxBytes` (1–65,536), `startLine` (1–1,000,000), `maxLines` (1–1,000) | `file-read-v1` metadata followed by numbered UTF-8 source, in separate text parts |
| `list` | `path` defaults to `.`; optional `maxEntries` (1–200) | `path`, typed `entries`, `skippedEntries`, `truncated` |
| `search` | Required single-line literal `query` (1–256 characters); existing file/directory `path` defaults to `.`; optional `maxMatches` (1–100), `caseSensitive` (default `true`), `contextLines` (0–20 per side, default 8), `include`/`exclude` globs, `mode` (`content` default or `files`) | `path`, `matches` with file/line/text, optional merged `context` windows, `skippedFiles`, `truncated`; files mode has `mode`, distinct `files`, empty `matches`, no context |

Paths cannot be absolute, contain parent traversal, backslashes or NUL. Requests contain no
permission override, alternate workspace, ignore bypass, regex or process flag. The host also
validates paths at the actual operation; plugin validation is not the security boundary.

Read-tool preparation only validates and snapshots arguments. It does not read file contents or list a
directory, and adds no world-state preconditions. Execution receives a fresh capability and
rechecks cancellation after awaiting it. The host's path refusals fail the operation directly;
they cannot become a request to approve a stale precondition.
The three read tools declare a `read` effect with no reversal or reconciliation operation.

Successful reads separate metadata from model-readable source as described below. List, search
and failures retain JSON inside one text part. Limits are upper bounds: the host and the serialized
output budget can reduce them further. Defaults request at most 16 KiB for reads, 50 list entries
or 20 search matches, reduced for the available output budget. Reads bound source bytes by the
requested/default limit and the whole output budget, then fit the serialized presentation exactly;
they do not reserve seven eighths of the budget before reading. Oversized responses shorten their
text/results and set `truncated: true`. A very small budget can return only `{"truncated":true}`.
A truncated or partially skipped search is not proof that the rest of the workspace contains no
matches. Failures remain failed outcomes.

Successful read presentation has two text parts. The first is JSON with `format: "file-read-v1"`,
`path`, the host's `bytesRead`, `truncated`, and its `lineRange` when presentation has not clipped
the returned source. It contains no source text. Its `presentation` object reports `startLine`,
`endLine` (null for empty output), `lastLineComplete` (null for empty output), `sourceBytes` and
`outputTruncated`. The second part contains the source once, with each LF-delimited line prefixed
by its number and `: `. Original CRLF, lone CR, Unicode and a missing final LF are preserved; a
terminal LF does not create another empty line. An empty file has an empty second text part.
Consumers can remove each expected, consecutively numbered prefix and concatenate the pieces to
recover exactly the presented source; line splitting must use LF only.

`bytesRead` remains the host's read count, while `presentation.sourceBytes` counts source actually
shown, without numbering. They can differ after output clipping or a host byte limit that omits
an incomplete UTF-8 character. Output accounting includes both serialized text parts, metadata
and line prefixes, within the original budget. Clipping prefers whole lines; an overlong first
line may retain a Unicode-code-point-safe prefix marked `lastLineComplete: false`. Clipped output
sets `outputTruncated` and removes the original `lineRange` rather than preserving false endpoints.

When a bounded continuation is available, `presentation.nextRead` gives `path`, `startLine` and
`maxLines: 200`. It repeats an incomplete last line, or starts after the last complete line.
Because a selected range can omit only earlier content, this is a continuation probe, not a claim
that later content exists. A complete empty range does not repeat itself. If a next line would
exceed the existing admitted start-line limit, `continuationBlocked: "startLine_limit"` replaces
the hint. A very long partial line can still exceed the byte budget when reread; the hint neither
raises limits nor promises completeness. A minimal truncation-only result has no source or range.

Search filters narrow the existing guarded scan before candidate body reads. `include` and `exclude`
each contain 1–8 strings of 1–128 characters, matched against workspace-relative paths even within
subdirectory searches. Includes are ORed; excludes win; neither overrides protected paths or ignore
rules. The host uses Node's POSIX glob matcher restricted to literals, `*`, `**` and `?`. Use
`**/*.ts` for nested paths; `*.ts` matches only at the workspace root. Dotfiles need explicit dot
patterns. Absolute paths, parent traversal, backslashes, controls, negation, braces, classes and
extglobs fail; `**` must occupy a complete path segment. Tests are not excluded unless the caller selects that filter.

`mode: "files"` returns distinct matching paths and no source text or context. `maxMatches` counts
files rather than lines. The same bounded read is still used; it is not an unbounded filename index.
Serialized clipping removes complete path entries, never fragments a filename. The default content
result shape stays unchanged. See [ADR 0025](../../../docs/decisions/0025-investigation-tool-selection.md).

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
three-character string, not two alternative patterns. An exact file scope never expands to siblings.
Search applies ancestor ignore rules to files as well as directories; a missing path fails.

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
result. Presentation preserves this distinction and separately reports its own clipping.

The host rejects binary/non-UTF-8 reads, protected paths and escaping symlinks. Explicit reads
and directory listings may resolve an internal symlink; recursive search skips symlinks and
honors scoped `.gitignore` rules. Exact-file search rejects symbolic-link leaves; an explicitly
selected directory can still resolve an internal symlink. Ignore compatibility limits and the residual filesystem race
assumptions are documented in [ADR 0009](../../../docs/decisions/0009-workspace-files.md).
No shell, arbitrary network or real-model capability is provided.

`create` takes `path` and `text`; `edit` takes `path`, `oldText` and `newText` with exactly one
literal match; `undo` takes a prior `snapshotId`. They declare snapshot-backed workspace writes,
prepare exact before/after previews and hash preconditions, and call only the runtime-bound
single-use apply capability. Outcomes include a snapshot ID. Execution exceptions propagate as
uncertain effects. See [controlled writes](../../../docs/writes.md) for opt-in, recovery and limits.

Tests beside this file use mock capabilities to check delegation, missing/denied capabilities,
cancellation, closed argument schemas, exact numbered source and bounded output. Actual filesystem confinement,
ignore behavior, revocation and runtime integration are checked in the host's tests.

Controlled write results retain their snapshot receipt and may include actual verified post-state
text under a separate read grant. The presenter bounds UTF-8 body bytes and the complete serialized
JSON, distinguishes absence from empty text, and reports unavailable/truncated observations.
See [write observations](../../../docs/decisions/0035-verified-write-observations.md); they verify
observed bytes, not task correctness.

## Model experience

The model receives six stable tool schemas with the arguments and limits described above. The
`read` description owns guidance to inspect ranges around search hits, group independent reads,
and avoid treating truncation as proof of absence. The `search` description tells the model to
inspect hits and gaps with `read startLine/maxLines`; its truncated/skipped warning remains.
These instructions live beside the tools and are not repeated in the default system prompt.
Tool registration order, schemas, execution and result boundaries are unchanged by this wording.

Descriptions and schemas have a fixed per-request token cost while the tool set is unchanged.
Tool-call arguments and returned source, metadata, hits, receipts or failures add tokens according
to their bounded size. `read` emits source once, with numbered lines; a verified post-write
observation reports bytes and does not certify factual correctness. Existing failures remain
visible as failed outcomes.

Calls and results append to the recorded history and preserve its earlier reusable prefix.
Changing a tool description or schema changes the prefix from that definition; ordinary file
results do not rewrite old messages. No context source or extra model call is introduced.
