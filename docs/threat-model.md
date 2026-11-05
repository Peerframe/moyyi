# Threat model

Status: D3 boundaries accepted on 2026-10-25 in
[ADR 0006](decisions/0006-security-boundaries.md); read-only workspace enforcement is merged from batch 5.
Merged phase 2 adds tested controlled writes and snapshots (see [ADR 0012](decisions/0012-controlled-workspace-writes.md)).
Merged phase 3 adds native process/file/network confinement under [ADR 0013](decisions/0013-native-process-sandbox.md).
Credential-store integration still requires its own verification.
The batch 7 CLI uses explicit trusted host callbacks, not a new credential-store adapter.
It escapes terminal control/bidirectional text and accepts approvals only for displayed digests;
explicit development modules remain trusted in-process code, not a sandbox.

## Assets

- The user's files inside and outside authorized workspaces
- Credentials: model API keys, tokens in the environment, files such as `~/.ssh`
- Session data: transcripts may contain private content
- External accounts reachable through tools

## Threats

| # | Threat | Example | Primary defense |
|---|---|---|---|
| T1 | Model mistake | Edits the wrong file, runs a destructive command | Scoped policy, digest-bound approval and precondition recheck; snapshots/undo in the write phase |
| T2 | Injected instructions in content | A file or web page tells the agent to upload `~/.ssh` | Content grants no authority; protected paths and separately enforced network egress |
| T3 | Malicious or buggy tool / MCP server | Tool annotations lie about being read-only | Effect profile is assigned by moyyi, not by the tool's self-description; MCP classes come from owner configuration ([ADR 0050](decisions/0050-mcp-client.md)) |
| T4 | Local adversary racing the agent | Swaps a symlink between check and write | Contained file access and race-aware implementation need validation; protection against a hostile process under the same OS account is not established |
| T5 | Credential disclosure | Provider key appears in a tool environment or debug log | Trusted-runtime credential handling, OS credential store preference, no authorization-header/environment dumps |
| T6 | Local session disclosure | Another account reads stored prompts or copied exports | Owner-only access controls and explicit retention/deletion; application-level encryption deferred |

## Boundaries

- Policy decides what the agent may *request*. Containment (OS sandbox) decides what a process can
  *do*. Policy alone is not a security boundary for `process` effects.
- A selected workspace grants only the supported, authorized operations. Phase 1 allows reads,
  lists and searches. Phase 2 writes require an explicit root grant; commands retain their phase 3 gate.
- Outside-workspace access requires an explicit scoped grant. Credential stores and protected
  files are exceptions even inside a workspace. Model output, tool output and project instructions
  cannot create or widen a grant.
- Tool/command network access is denied by default, with explicit destination/capability and
  operation grants. Model API access is separately configured and does not grant tool egress.
- Shell execution requires verified OS containment. An unavailable sandbox does not permit a
  silent unrestricted fallback. In-process installed code plugins remain trusted code as described
  in [architecture.md](architecture.md); these policies do not sandbox malicious installed code.
- Runtime-managed credentials stay out of model content, ordinary tool results, transcripts and
  logs. Arbitrary content may still contain secrets; universal redaction is not claimed.
- Local transcripts, rendered requests and blobs may be plaintext in v1, protected by OS access
  controls. Application-level session encryption is not a first-version prerequisite. These
  controls do not establish protection against root, account compromise or all same-user processes.
- Retention/deletion must cover session records and their blobs, with backup/export limits made
  explicit. Immutable history prevents silent rewrites; it does not remove the user's ability to
  request deletion.

## Local daemon boundary

[ADR 0048](decisions/0048-local-daemon.md) adds a local entry point. The socket and a per-start
256-bit token live in the owner-only data directory; clients and daemon check ownership and
modes, and the daemon never listens on a network interface. It does not change T4 or T6: a
process of the same account could already read the store. Client frames are untrusted input,
validated and bounded before the runtime sees them; they cannot change grants, choose another
workspace for new sessions, or send non-text content. Approvals still require the displayed digest.

## Long-running sessions

[ADR 0049](decisions/0049-long-running-sessions.md) adds opt-in authority conveniences. Writable
commands keep OS confinement, network denial and per-command approval but have no snapshots, so
T1 recovery depends on version control. Session approvals let one owner approval cover later
calls of the same tool (or the same exact command) in that session; they live in memory, never
override a denial or revocation, and are not restored on reopen. Model output cannot create one.
Background commands outlive their call but not their grant: they stay in the sandbox, stop on
any grant change, their own time limit or runtime close, and are reachable only from the
session that started them.

## Sub-agents

[ADR 0051](decisions/0051-read-only-subagents.md) sub-agents run on a core with only read-class
tools, so a delegated brief, or a prompt injection it reads, cannot write, run commands, reach
the web or start further sub-agents. Their reports are model output returned to the main agent,
not verified results. Request, time, concurrency and per-run limits bound their cost.

## MCP servers

[ADR 0050](decisions/0050-mcp-client.md) addresses T3 for MCP: a tool's class and approval come
from the owner's configuration, never from server annotations. Servers are owner-chosen local
programs and are not sandboxed; their descriptions and results are untrusted text bounded and
labeled before the model reads them. Only trusted host code can add a server.

## Remaining implementation and validation

- Batch 5 implements read-only path checks and revocable per-invocation file capabilities;
  [files.md](files.md) defines protected paths, limits and tested behavior. Phase 2 adds separately
  granted [writes](writes.md). Phase 3 adds a separate explicit [command grant](shell.md); T4 remains unchanged.
- Phase 3 uses actual native confinement and process-group cleanup, with no unrestricted fallback.
  Mac detached descendants and host SIGKILL cleanup are not guaranteed. Linux masks existing
  protected paths; concurrent host secret injection is unsupported. Native mode does not impose
  CPU/memory/disk quotas or promise command rollback. See shell usage and current acceptance.
- Before credential integration: choose the OS credential-store adapter and document availability,
  import/removal and any fallback behavior without exposing values to models or tools.
- For local storage and exports: define access-control checks, retention, reference-aware blob
  deletion and export redaction. Session encryption remains a future enhancement.
- Preserve prompt-injection and authorization-denial evals; neither approval prompts nor a passing
  model eval demonstrates OS containment. No second-model automatic approval layer is required.

These items belong to their implementation briefs. D3 is decided, but no later batch is started
or authorized merely by accepting this document.


## Phase 5 web boundary

[ADR 0015](decisions/0015-anthropic-and-web.md) implements tool networking independently of model
API credentials. Exact host grants and per-action approvals bind destination/query; preparation
has no DNS/network effects. Runtime verifies all resolved public IPv4 addresses and pins the actual
TLS connection with ordinary certificate checks. No redirects, ambient proxy, cookie, provider key
or local file capability accompanies a web invocation. Revocation/cancellation closes in-flight
requests; uncertain external effects stay unknown and do not replay on restart.

HTML/search snippets remain untrusted data. The injection conformance eval deliberately attempts
secret reads, writes and ungranted egress, checking actual canaries and request counts. It proves
those enforced boundaries, not universal model resistance or prevention of disclosure through an
already authorized URL/query. Host-installed modules remain trusted; test-only transport injection
cannot establish production network isolation. See [web scope/limits](web.md). Provider API requests
still transmit the selected model context under their own explicit connection; web restrictions do
not constrain that separate channel. No live provider/search task quality is claimed.
