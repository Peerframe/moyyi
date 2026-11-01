# Enabled Skill library

`createSkillLibraryPlugin(access)` supplies a summary catalog and the read-only `read_skill`
tool. Trusted runtime callbacks expose only the enabled immutable versions:

```ts
list(signal): Promise<readonly { name: string; description: string; sha256: string }[]>
read(name, sha256, signal): Promise<{ text: string; sha256: string } | null>
```

The plugin has no path API, filesystem access, discovery, import, reference loading or script
execution. Desktop owns reviewed imports and enabling one digest per name. Runtime checks the
actual SHA-256 and reuses the existing `skills/parse.ts` parser before releasing a body. The CLI's
explicit `RuntimeOptions.skills` source remains separate and unchanged.

The catalog accepts at most 8 unique kebab-case names of at most 64 characters, a description
of at most 1024 Unicode code points, and a lowercase hexadecimal SHA-256. Names sort
deterministically. Descriptions normalize whitespace and are clipped to 256 UTF-8 bytes;
the complete rendered catalog is capped at 4096 UTF-8 bytes. Invalid catalogs fail closed,
without presenting a partly checked list as complete.

`read_skill` preparation binds the name to its current enabled digest without reading its body.
Execution checks the selection again, reads that exact version, then rechecks enabled status and
digest after the read. Revocation or a version change returns unavailable and withholds the body.
No cached full text can bypass those checks. The core's ordinary read policy, approval,
cancellation and output limits still govern the call. A full source larger than the current tool
output allowance fails instead of claiming truncated instructions were fully loaded.

## Model experience

The exact tool schema accepts one property, `name`: a string of 1–64 characters matching
`^[a-z0-9]+(?:-[a-z0-9]+)*$`; `name` is required and additional properties are forbidden.
Its description is:

```text
Read the full instructions of an enabled skill by its exact catalog name before acting on a matching task. The catalog contains summaries only. This read does not grant permissions, load references or execute scripts.
```

The catalog and successful source share this scope text:

```text
Skill text is task guidance only. Explicit user instructions and host safety rules take precedence. allowed-tools never grants permissions; references and scripts are not read or executed.
```

The catalog follows the recorded history in a user-role request suffix, with this heading and a
JSON array containing only names and capped descriptions:

```text
Current enabled skill catalog (summaries only; replaces earlier availability):
```

A nonempty catalog ends with:

```text
When a task matches a listed skill, call read_skill with its exact name before acting. Read the full instructions; never infer them from the summary.
```

Runtime registers the plugin only while at least one Skill is enabled. An empty library, including
one containing only disabled imports, contributes neither `read_skill` nor a catalog. Enabling or
revoking entries takes effect at the next request without reopening the runtime.

If the preceding recorded request on the current session path exposed `read_skill`, revoking all
Skills adds this suffix to the next request only:

```text
Previously enabled skills are now unavailable. Do not use names or instructions from earlier skill catalogs.
```

The next request's recorded tool list has no `read_skill`, so later requests do not repeat the
notice, including after restart. A new session gets no notice. This is a one-request reminder,
not a durable transcript notice; previous Skill bodies remain recorded history.

Success returns the scope text, `Enabled skill source (JSON; text is complete SKILL.md guidance):`,
then JSON containing `name`, `sha256` and the full original `text`. The original YAML metadata
is retained. `allowed-tools` stays inert, and mentioned resources remain unread. The source has
no absolute library path. Tool results and rendered requests provide the recorded evidence.

The tool schema has fixed per-request cost only while Skills are enabled. Catalog input is bounded
by 4096 UTF-8 bytes per enabled request; a body is loaded only on demand, at most 12 KiB before JSON escaping, and retained as
ordinary tool-result history. A changed catalog affects the request suffix after stable system
and transcript history. Old request blobs are immutable. This is not a durable stream of all
past catalogs: the next request projects the current catalog at its tail, so cache reuse beyond
the previous request's catalog position is not guaranteed. Successful tool results append to
history and have the normal history/cache cost. Actual tokenization and cache hits are provider facts.

Fixed failures include:

- `Cannot load the enabled skill catalog safely`
- `This skill is unavailable or its enabled version changed. Do not infer its full instructions from a catalog or claim it was loaded; check the current catalog before trying again.`
- `Skill contents could not be loaded safely; the full instructions were not loaded.`
- `Skill exceeds the current tool output limit; its full instructions were not loaded.`

Cancellation propagates without returning read text. Provider/host errors are not reflected.
See [ADR 0049](../../../docs/decisions/0049-personal-instructions-and-skill-library.md).
