# 0006: Workspace authority and execution boundaries

Status: accepted (2026-10-25), owner decision D3; implementation pending

## Context

moyyi is a personal agent with a self-owned core. It needs useful autonomy inside an authorized
workspace, while model output, imported instructions and tool output remain untrusted. Repeated
approval prompts do not contain a process, and a sandbox does not decide whether an action serves
the user's request.

The owner accepted the researched D3 recommendation and explicitly excluded application-level
session encryption from the first-version prerequisites. This ADR records that decision; it does
not authorize batch 3 or add write, shell or network tools to phase 1.

## Decision

### Workspace and approvals

- The user selects the workspace. Operations within its granted scope may proceed without a new
  prompt for every action. Phase 1 remains read-only; this decision does not grant write access.
- Access outside that scope requires an explicit, narrower grant. A workspace grant does not
  automatically authorize credential files, private keys, token stores or other protected paths
  inside the workspace. The implementation must account for resolved paths and symlink escape.
- Base policy returns `allow`, `ask` or `deny`. Remembered grants identify their operation,
  resource scope and lifetime, are visible to the user and can be revoked. A grant never expands
  because a model, repository instruction or tool result requests it.
- For actions that require approval, preserve the existing action-digest binding and precondition
  recheck. Changed actions need a fresh policy decision; a denial is not a request to retry through
  another tool. Plugin policy rules can only restrict authority.
- Use deterministic policy for clear cases and ask the user when the required authority is
  unclear. A second model that automatically approves actions is not part of the first version.

### Processes and network

- Commands require actual OS-enforced containment when the shell phase is implemented. Policy,
  command-string inspection, working-directory selection and a subprocess alone are insufficient.
  If the required containment is unavailable, the restricted command path must fail closed;
  it must not silently execute on the unrestricted host.
- Tool and command network access is denied by default. Grants must specify the destination or
  capability and the permitted operation. The enforcement must cover the actual connection,
  including redirects or other ways of reaching a destination outside the grant.
- Model-provider traffic is a separate trusted-runtime capability. Configuring a provider grants
  its adapter access to the selected service; it does not grant arbitrary tool egress or expose
  provider credentials to commands. The model adapter cannot execute tools or approve actions.
- No particular sandbox backend or cross-platform security guarantee is selected by this ADR.
  Those choices need evidence and denial/cancellation/interruption tests in the shell-phase brief.

### Credentials and local sessions

- Prefer the OS credential store for durable credentials. Trusted runtime services obtain and use
  them for the authorized provider or tool; do not put credential values in prompts, ordinary tool
  results, transcripts or logs. Do not dump authorization headers or the parent environment into
  diagnostics. The exact credential-store integration and any supported fallback remain
  implementation choices to document before use, not permission to store keys in plaintext.
- Protect the local data directory, database, blobs and exports with owner-only access controls
  appropriate to the supported OS. Retention and user-requested deletion must account for the
  database and referenced blobs together. Explain the limits for backups and copied exports;
  do not promise secure erasure from physical media.
- **Application-level encryption of sessions and rendered requests is not required for v1.**
  It remains a later enhancement. Local access controls do not protect against an administrator,
  a compromised user account or every process running as that user; disk encryption is a separate
  operating-system protection, not a moyyi guarantee.
- Runtime-managed credentials must be excluded by construction. Arbitrary user-provided content
  can still contain sensitive information: no universal secret-detection or redaction guarantee
  is claimed. Specify export redaction and protected-path behavior before exposing those features.

## Alternatives and tradeoffs

- Asking for every operation adds interruptions without providing process isolation. Scoped
  autonomy plus deterministic checks is the accepted balance.
- Broad host access is easier to integrate but cannot enforce the intended workspace and network
  boundary. It is not the fallback for an unavailable sandbox.
- Encrypting all session storage immediately would add key recovery, rotation and portability
  work. The owner chose access controls and lifecycle handling first, accepting the local-account
  exposure described above; credentials remain a separate concern.
- Model-based approval can be evaluated later, but introduces another fallible decision-maker.
  It does not replace user authority, deterministic policy or containment.

## Evidence and limits

Official documentation reviewed on 2026-10-25:

- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing) distinguishes permissions
  from OS-enforced filesystem/network restrictions and documents what remains outside the sandbox.
- [OpenCode permissions](https://opencode.ai/docs/permissions/) provides the simple
  `allow` / `ask` / `deny` vocabulary. Its other defaults are not adopted here.
- [Claude Code local storage](https://code.claude.com/docs/en/claude-directory#plaintext-storage)
  describes plaintext local state; application-level session encryption is not a universal
  prerequisite among existing agents. That observation does not establish moyyi's security.

These are design references, not dependencies or copied source. The accepted boundaries still
need implementation and tests. The [threat model](../threat-model.md) tracks residual assumptions;
the [handoff brief](../tasks/2026-10-24-codex-handoff.md) controls when work may start.
