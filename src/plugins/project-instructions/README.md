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

Automatic discovery is limited to the root file. There is no recursive scan, ancestor search
outside the workspace, user-home loading, `AGENTS.override.md` fallback, alternate brand
filename, or Markdown/import expansion. Nested `AGENTS.md` files must be found and read through
ordinary tools before work in their scope; their more specific guidance applies only to their
own subtree. The default working instructions explain this limitation to the model.

Tests exercise loaded, absent, blocked, changing, failed, and cancelled results, including
lossless encoding of adversarial source text. Integration/eval checks must additionally prove
runtime access boundaries, actual request inclusion, and recording/replay behavior. No live
model adherence claim follows from these deterministic tests.
