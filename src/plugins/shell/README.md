# shell

Registers one process-effect tool through `ToolContext.processes`. It takes `command`, an
optional workspace-relative `cwd` (default `.`), and `timeoutMs` (default 30 seconds, at most
120 seconds). The runtime supplies the OS sandbox, explicit root grant and clean environment.
It never accepts a model-selected shell executable, environment, network grant or backend.

The host must opt in using `workspaceProcesses`; file-write grants do not enable commands.
The executor owns validation, exact approval, lease, durable journal and capability lifetime.
No command runs during preparation. Execution receives no replacement command arguments.

Normal zero/nonzero exit becomes succeeded/failed, which describes process exit, not task
correctness. Cancellation, timeout, revocation, output exhaustion or uncertain cleanup throws
into the executor's unknown-effect path; no retry or rollback is attempted. Restart reconciliation
cannot infer command outcomes. Commands may partially modify files, without phase 2 snapshots.
See [shell usage](../../../docs/shell.md) and [ADR 0013](../../../docs/decisions/0013-native-process-sandbox.md).
