# Threat model

Status: D3 boundaries accepted on 2026-10-25 in
[ADR 0006](decisions/0006-security-boundaries.md); read-only workspace enforcement is implemented in the batch 5 review branch.
Later write, process, network and credential defenses still require their own verification.

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
| T3 | Malicious or buggy tool / MCP server | Tool annotations lie about being read-only | Effect profile is assigned by moyyi, not by the tool's self-description; MCP is a later phase |
| T4 | Local adversary racing the agent | Swaps a symlink between check and write | Contained file access and race-aware implementation need validation; protection against a hostile process under the same OS account is not established |
| T5 | Credential disclosure | Provider key appears in a tool environment or debug log | Trusted-runtime credential handling, OS credential store preference, no authorization-header/environment dumps |
| T6 | Local session disclosure | Another account reads stored prompts or copied exports | Owner-only access controls and explicit retention/deletion; application-level encryption deferred |

## Boundaries

- Policy decides what the agent may *request*. Containment (OS sandbox) decides what a process can
  *do*. Policy alone is not a security boundary for `process` effects.
- A selected workspace grants only the supported, authorized operations. Phase 1 allows reads,
  lists and searches; writes and commands retain their later-phase gates.
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

## Remaining implementation and validation

- Batch 5 implements read-only path checks and revocable per-invocation file capabilities;
  [files.md](files.md) defines protected paths, limits and tested behavior. No write or process
  authority is exposed. The hostile same-user race limit in T4 remains unchanged.
- Before writes/shell: select and verify containment for each claimed platform; test connection
  restrictions, cancellation, interruption and filesystem races. Resolve any proposed threat-model
  expansion with the owner rather than claiming it implicitly.
- Before credential integration: choose the OS credential-store adapter and document availability,
  import/removal and any fallback behavior without exposing values to models or tools.
- For local storage and exports: define access-control checks, retention, reference-aware blob
  deletion and export redaction. Session encryption remains a future enhancement.
- Preserve prompt-injection and authorization-denial evals; neither approval prompts nor a passing
  model eval demonstrates OS containment. No second-model automatic approval layer is required.

These items belong to their implementation briefs. D3 is decided, but no later batch is started
or authorized merely by accepting this document.
