# Workspace navigation plugin

Contributes a bounded list of workspace-relative paths through the existing context-source
extension. The trusted host must set `RuntimeOptions.workspaceNavigation: true`; omission or
`false` registers no navigation plugin and performs no additional scan. Plugin configuration is
not supported. The startup boolean is copied before asynchronous setup and changing the host
object later does not enable or disable an existing runtime.

Runtime supplies only an expiring `workspaceNavigation.read()` port. It checks the automatic
context grant and ordinary `list`/`read` preparation grant for each inspected directory or
ignore file, including restrictive plugin rules in both phases. Missing grants, `ask`, or `deny`
never become implicit approval. A blocked overview means unknown directory contents, not an
empty workspace. Cancellation, policy revision changes, and collection completion invalidate
the port. Concurrent reads in one collection share one immutable result; the next collection
reads the current workspace again.

The result is path navigation, not file contents, source evidence, a task plan, or authority.
Filenames remain quoted JSON data. Discovery follows the runtime's workspace confinement,
protected paths, ignore rules and scan/output bounds. Truncation and skipped entries are explicit;
absence from a partial overview proves nothing. No references, scripts or network are executed.

The section is `optional: true` and `stability: "turn"`. Context admission may omit the whole
overview when the full request would exceed the existing model budget; required instructions,
history, tools, and final-request restrictions are unchanged. Rendered request recording retains
the exact admitted overview without changing persisted v1. This reduces navigation latency; it
does not establish factual correctness or autonomous task success.
