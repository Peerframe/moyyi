# ADR 0017: Working instructions and bounded project guidance

Status: accepted for this implementation, 2026-10-26. D1–D6 are unchanged.

## Problem

The installed agent can complete a real DeepSeek read/tool-result/answer loop, but its default
system context is empty. A selected workspace's conventions never reach the model automatically.
Copying an older agent's prompt or importing its harness would obscure ownership and authority.

## Evidence and alternatives

Reviewed on 2026-10-26:

- [AGENTS.md](https://agents.md/) defines ordinary Markdown project guidance, directory scope,
  more specific rules and precedence of explicit user instructions.
- [Codex source](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/agents_md.rs),
  `rust-v0.164.0`, bounds discovery to an ordered project-root-to-working-directory chain,
  tracks sources and shares a byte budget. The
  [official guide](https://developers.openai.com/codex/guides/agents-md/) documents a default
  32 KiB aggregate limit. We do not copy its symlink or truncation behavior.
- [Gemini CLI guidance](https://github.com/google-gemini/gemini-cli/blob/6006c14a4decfe4b891c6263ad6ad5992e404b5b/docs/cli/gemini-md.md),
  `v0.65.0`, describes just-in-time nested rules tied to tool paths and trusted roots.

We use the open filename convention and our existing context-source extension. A whole-workspace
recursive scan would blend incompatible subtree rules, spend context on unrelated directories
and read files unrelated to the task. Automatic nested discovery needs explicit target-path
information; today's context port has no such information. A second harness is unnecessary.
No upstream or OpenBot source/prompt was copied or substantially adapted; no dependency is added.

## Decision

Two built-in plugins contribute context through the existing extension point:

- `default-instructions`: a short, original static working prompt. It describes
  evidence gathering, authorized execution, proportionate validation, truthful reporting,
  respecting user constraints, and treating tool/page/file content as data rather than authority.
- `project-instructions`: automatic guidance from **only `workspaceRoot/AGENTS.md`**. It includes
  the relative path, workspace scope, SHA-256 of the decoded UTF-8 text, and JSON-encoded content.
  Explicit user instructions and higher-priority safety/permission boundaries take precedence.

No home directory, parent directory, nested directory, alias filename, Markdown link or import
is automatically traversed. Nested AGENTS.md files must be read with ordinary authorized tools
before working in their subtree; more specific rules apply only there. This prompt guidance is
not an implemented just-in-time loader or proof of real-model compliance.

The runtime supplies a fixed-path `readRoot()` capability to context sources, not general fs or
process access. It reuses the existing confined reader and protected-path exclusions, but rejects
all symlinks and hardlinks for automatic guidance. The one file must be complete regular UTF-8
text, at most **16 KiB**. Unlike upstream truncation, oversize/invalid/unreadable files stop the
request before the provider is invoked; missing or empty files are normal. The smaller one-file
limit preserves room for history under our conservative byte-based context estimate. Whole-request
budget checks still apply. An explicitly named root AGENTS.md is read like an explicit `read`:
`.gitignore` controls discovery/search, not permission for this fixed filename.

`PermissionPolicy.beforeContextRead(path)` is a new optional, nonpersisted authorization hook.
Missing hooks on custom policies mean **no automatic read**. The default policies reuse their
read grant and `requireApproval: ["read"]`; `ask` cannot become implicit approval. Ordinary
`beforePrepare("read", ..., {path: "AGENTS.md"})` and restrictive plugin rules in both phases
also apply. No fake tool effect, digest or approval is created. A denied/ask/unsupported policy
produces an explicit unavailable-guidance notice, never a claim that the file is absent. A host
can set `projectInstructions: false` to disable automatic discovery entirely.

Core passes its actual run cancellation signal to context collection. Capabilities expire after
collection, including when another source fails, and recheck policy revision throughout reads.
One collection shares one read snapshot; every new model request reads again. Edit/deletion takes
effect at the next request, not retroactively during a running response/tool execution. These
checks reduce filesystem races; they do not isolate against a hostile process with the same UID.

## Persistence, replay and validation

The exact rendered system context is already committed as a content-addressed request blob before
the model request. No persisted v1 field changes. Rules are not rewritten into conversation history;
after compaction/restart the next ordinary request recollects them. Tool-free compaction keeps its
existing dedicated summary prompt. The two plugins cannot rewrite history or unsettled effects.

Record/replay continues to require exact request identity. Changed rules, changed default prompt,
or changed availability invalidate an old recorded request; no live fallback or repaired recording
is permitted. Earlier recordings made with an empty system context are not silently migrated.

Tests and the offline instruction conformance suite use the public runtime, real disposable files,
SQLite and a scripted model to check context, refresh, authority, cancellation and replay. They
prove wiring and enforcement, not whether DeepSeek reliably follows prose. The 30 public-task
checkers, paid-call requirement and formal-publication boundary are unchanged.
