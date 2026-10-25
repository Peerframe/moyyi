# Read-only workspace files

Batch 5 adds real `read`, `list` and `search` tools to the programmatic runtime. Run:

```sh
npm ci
npm run demo:files
npm run eval:files
```

The demo creates a temporary project and SQLite store, lists files, searches for a function,
reads its source and verifies that each stored tool result reaches the next model request.
The model responses are scripted. File I/O and persistence are real; this is not evidence of
DeepSeek compatibility or autonomous task quality. Temporary fixtures are removed on exit.

## Using the tools

`createRuntime` registers the built-in `fs` plugin before caller-supplied plugins. Select a
model and storage as described in [core.md](core.md), then create a session with the selected
workspace. The model receives the `fs` schemas; read/list/search remain the default granted operations. Duplicate names fail plugin
loading instead of replacing a built-in capability.

The [plugin README](../src/plugins/fs/README.md) describes arguments and JSON results. Search
uses literal text, includes line numbers and is case-sensitive by default. It traverses ordinary
and hidden workspace files subject to protected paths and `.gitignore`; it does not load global
Git excludes or `.git/info/exclude`. Direct reads/lists do not use ignore rules. Every result
reports truncation, and lists/searches report skipped entries. A bounded or skipped search is
not proof that no other match exists. `search.path` must be an existing directory. Patterns such
as `foo|bar` remain literal text, not alternation or regular expressions.

To follow a search hit into its surrounding implementation, use a bounded line range:

```json
{"path":"src/example.ts","startLine":400,"maxLines":60}
```

Without either line option, `read` retains the existing bounded prefix behavior. Supplying one
enables range mode; defaults are line 1 and 200 lines, with limits of 1,000,000 for `startLine`
and 1,000 for `maxLines`. Range mode scans at most 1 MiB through the same guarded read path
and refuses an incomplete scan. It cannot retrieve ranges from larger files. The existing
byte and output limits still apply; requesting later lines does not raise them.

Range results retain original text delimiters and report `lineRange` with the requested
`startLine`, last represented `endLine` (or `null` for empty text), and `complete`. Lines are
LF-delimited and 1-based; CRLF is retained, and a trailing LF creates no extra empty line.
`complete` means the selected range up to EOF was not byte-cut; it does not prove full-file
coverage. `truncated` reports omitted file content, including lines before/after the requested
range. An empty EOF/out-of-range result has `endLine: null`. If later JSON output clipping
shortens the result, `lineRange` is removed to avoid incorrect endpoints. See the plugin README
for exact field semantics; no additional filesystem or policy authority is introduced.

The runtime applies independent ceilings: 1 MiB per scanned file, 16 MiB charged scan budget,
10,000 visited entries, 32 recursive levels, 2,000 characters per matching line, 16 KiB per
`.gitignore` and 64 KiB total ignore files. The public tools impose smaller request limits
(read 64 KiB, list 200 entries, search 100 matches) and reduce them for the core output budget.
Large text is returned as a marked prefix by default; range mode is limited to complete scans
within 1 MiB. Binary/non-UTF-8 reads fail. No regex or command
subprocess is exposed. [ADR 0009](decisions/0009-workspace-files.md) records the dependency
choice and unsupported ignore patterns, which fail the search rather than weaken exclusions.

## Authority and lifetime

Paths must be workspace-relative and cannot contain parent traversal. The host rechecks the
workspace, lexical and resolved path, and file identity at operation time. Explicit read/list
can resolve authorized internal symlinks; recursive traversal skips symlinks. Escaping links,
nonregular reads and multiply-linked files are rejected. File content comes from a verified
descriptor, with bounded reads and identity/metadata checks before returning it.

Both lexical and resolved paths reject the existing credential deny list: `.ssh`, `.aws`,
`.azure`, `.gnupg`, `.kube`, `.npmrc`, `.netrc`, `.pypirc`, `credentials`, `credentials.json`,
standard private-key names, `.env`/`.env.*`, and `.key`/`.pem` suffixes. Matching is
case-insensitive per path component. This may deny harmless examples or certificates; it is
not universal secret detection. `.git` and `.moyyi` are additionally excluded.

The runtime automatically excludes its concrete SQLite directory, including when the store
was injected. Hosts using another store can pass absolute `protectedPaths` for private data.
Each configured exclusion protects both its lexical and resolved identity, including OS or
symlink aliases. Missing leaves bind through their nearest existing ancestor; inaccessible or
dangling-link configurations fail runtime creation. Exclusions are fixed for that runtime.
Model arguments and ignore negations cannot add permissions or bypass exclusions.

The executor creates a fresh `ToolContext.files` for each `prepare` or `execute` invocation.
It expires when that invocation returns. I/O checks the live permission revision and cancellation
signal before and after each asynchronous operation and before returning content. Revoking a
`ReadOnlyPolicy` grant and granting it again cannot revive an older capability. Reusing the
same policy instance across runtimes deliberately shares its grant lifetime; use separate
instances for independent grants. File preparation performs no I/O and creates no world-state
preconditions, so a protected-path refusal never becomes an approval request.

## Evidence and limits

Host tests use disposable real files; integration tests verify persistence and the next model
request, actual denial, revoked/expired capabilities and cancellation. Supported ignore examples
are compared with Git's own `check-ignore` command in tests. The eight file eval scenarios use
public runtime commands/events and synthetic canaries. They do not modify the public task corpus
or read private eval data. See the [handoff](tasks/2026-10-25-batch-5-files.md) for final evidence.

These checks are not a kernel sandbox against a hostile process under the same OS account.
Node's final-component `O_NOFOLLOW` and repeated identity checks do not eliminate all parent
directory races. Read cancellation discards unreturned content and closes handles after pending
I/O settles; it cannot retract a syscall. Windows, network filesystems and adversarial same-user
race resistance are not claimed. Native containment, writes, shell, real models and interactive
CLI were outside the original batch 5 delivery; the provider is now merged and the
[CLI](cli.md) is merged. Phase 2 adds separately opted-in [controlled writes](writes.md);
process capabilities remain out of scope.
