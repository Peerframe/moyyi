# Project instructions

`projectInstructionsPlugin` contributes the selected workspace's root `AGENTS.md` through the
existing context-source extension point. The runtime supplies the fixed-path, read-only
`projectInstructions.readRoot()` port. The plugin has no filesystem access and accepts no
configuration.

Each context collection reads the port again. A loaded section has a stable identity and
`turn` stability, with a JSON-encoded source containing the relative path, scope `.`, SHA-256
content digest, and complete text. A missing port or absent file contributes no section. A
blocked read contributes an explicit notice that the rules remain unknown; it must not be
presented as proof that no rules exist. Cancellation before or during collection prevents
publishing its result. Errors from the port are not silently converted into missing guidance.

Root instructions guide work in the selected workspace. They cannot grant capabilities,
approve effects, change host policy, or override explicit user requirements and higher-priority
safety boundaries. The executor remains responsible for authority. JSON encoding preserves
text and source boundaries; it is not a guarantee against model prompt injection.

By default, automatic discovery is limited to the root file. There is no recursive scan, ancestor
search outside the workspace, user-home loading, `AGENTS.override.md` fallback, alternate brand
filename, or Markdown/import expansion. Nested `AGENTS.md` files must be found and read through
ordinary tools before work in their scope; their more specific guidance applies only to their
own subtree. The default working instructions explain this limitation to the model.

When the host enables nested instructions, the port also offers `readNested()`, and the plugin
adds one `turn` section, `project-instructions.nested`, after the root section
([ADR 0052](../../../docs/decisions/0052-nested-instructions.md)).

## Model experience

- **What the model sees**: for the root file, the scope statement above and a JSON source
  `{path: "AGENTS.md", scope: ".", sha256, text}`, or the "could not be loaded" notice. For
  nested files: a fixed statement that each file applies only under its scope, that the nearest
  scope wins over broader guidance and that explicit user instructions and safety boundaries win
  over all; then a JSON list of `{path, scope, sha256, text}` or `{path, scope, unavailable}`.
- **Token cost**: the root file (at most 16 KiB) on every request; with nested instructions, up
  to 8 more files and 32 KiB in total, growing as the session works in more directories.
- **Prompt-cache effect**: both are `turn` sections after static and session sections. Editing a
  file, or touching a new directory with an `AGENTS.md`, invalidates the cache from that section
  on.

Tests exercise loaded, absent, blocked, changing, failed, and cancelled results, including
lossless encoding of adversarial source text. Integration/eval checks must additionally prove
runtime access boundaries, actual request inclusion, and recording/replay behavior. No live
model adherence claim follows from these deterministic tests.
