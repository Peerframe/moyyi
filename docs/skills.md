# Explicitly enabled Skills

moyyi can load Agent Skills guidance from a library you choose. Skills are text, with no permission
to write files, run commands, access the network or bypass approvals. Enabling a skill does not
install software or execute its scripts. This first version uses explicit activation: only the
named skills are loaded, in your configured order. There is no automatic library search or
model-selected activation.

## Configure a local skill

Create a regular directory outside private runtime/session/credential directories, for example
`~/moyyi-skills/code-review/`, and save this regular UTF-8 file as `SKILL.md`:

```markdown
---
name: code-review
description: Review code changes for correctness and useful validation.
---
Read the changed code and the relevant caller before drawing conclusions.
Report actionable defects with a concrete failure case. Separate unverified assumptions from evidence.
```

In the existing trusted `--host` module, add this property to the default-exported options object:

```js
skills: {
  root: "/absolute/path/to/moyyi-skills",
  enabled: ["code-review"],
},
```

Use an actual absolute path; `~` is not expanded inside a JavaScript string. Keep your existing
model and credential configuration. Start moyyi with the same host file and workspace as before,
for example `moyyi --host /absolute/path/to/host.mjs -C /absolute/path/to/project`. Sending a prompt
to a real provider remains a potentially paid request; loading this host alone does not make one.
Remove a name from `enabled` (or remove `skills`) and restart to disable it. Configuration is copied
at startup. Editing an enabled SKILL.md refreshes its guidance before the next ordinary model
request, including tool continuation and the first request after compaction/restart.

## Access and interpretation

The host-selected root and names grant only the selected `name/SKILL.md` reads. Automatic collection
also requires the runtime read grant and `beforeContextRead` permission. Custom policies receive
the actual absolute selected path, while root `AGENTS.md` retains its workspace-relative path.
Restrictive plugin rules apply in both phases. A missing hook, denial or approval-required read
produces an explicit unavailable-skill notice; it does not read the document or invent an approval.
With `--approve-reads`, Skills are therefore unavailable automatically. Enable the appropriate
host read policy only if you intend those documents to enter model context.

Skills are subordinate guidance. `allowed-tools` is accepted as inert metadata and does not change
the runtime's tools or grants. Markdown links, references, assets and scripts are not loaded or
executed. Their text can describe actions, but each action still needs ordinary authorized tools.
For now, put the required instructions directly in SKILL.md. Files outside the selected workspace
are not made accessible to ordinary tools just because they belong to the skill library.

A source block contains the skill name, relative source path, SHA-256 of the exact decoded UTF-8
text, and that text. Absolute library paths are not sent to the model. The already-existing request
record retains the block; old transcripts are not rewritten. A recorded request replays only while
the same guidance/availability and all other request fields match. Changes fail replay without a
live fallback. Text you enable is sent to the selected provider and may be retained in local session
or optional recording data; select only material you intend to use in that context.

## Supported format and limits

This is a bounded subset of the [Agent Skills specification](https://agentskills.io/specification):
YAML 1.2 frontmatter between `---` lines, then a non-empty Markdown body. Required `name` must match
the selected folder, use ASCII lowercase letters/digits separated by single hyphens, and be at most
64 characters; `description` must be a non-empty string of at most 1024 characters. Optional
`license`, `compatibility`, `metadata` and `allowed-tools` are accepted. Unknown fields are rejected.
Unicode skill identifiers and empty body documents are outside this first profile.

- At most 8 distinct enabled names, 12 KiB per complete file, 48 KiB accepted skill text per
  collection. Alongside root AGENTS.md's 16 KiB, automatic source text is at most 64 KiB. The
  existing whole-request context budget also applies, including JSON framing, history and tools;
  no skill is silently truncated or dropped to make a request fit.
- Frontmatter: 4 KiB, at most 256 YAML nodes and depth 8. No aliases, anchors, tags, directives,
  duplicate keys, non-string mapping keys or prototype-related keys. String scalar semantics use
  the mature `yaml` package, including quoted/block/folded values; numbers/booleans are not coerced.
- Optional `license` and `compatibility`: non-empty strings, at most 500 characters;
  `allowed-tools`: non-empty string, at most 1024. `metadata`: at most 32 non-empty string pairs,
  key length at most 100 and value length at most 500. These are local limits, not claims that
  every standard-compatible skill uses them. Unsupported control characters are rejected.
- Library root and selected skill directory must be real directories; SKILL.md must be a regular
  single-link file. No final-root, skill-directory or file symlinks, hardlinks or special files.
  Private runtime/store/recording paths, configured protected paths and secret-name paths remain
  blocked. OS aliases in root ancestors (such as macOS `/var`) follow the existing reader rules.
- An explicitly enabled file is read even if `.gitignore` excludes it: ignore rules are discovery
  hints, not permissions. Missing, unreadable, invalid or oversized enabled files fail before the
  model request; remove/fix the selected file instead of relying on an empty fallback.

The capability expires after context collection and follows cancellation, policy revocation and
other context-source failure. File identity and metadata checks reduce replacement races; they do
not isolate against a hostile process running as the same OS user. Hashes identify collected text,
not trust or approval. The offline suite proves these boundaries with synthetic files/models; it
does not prove that a live model follows every instruction. No paid model test is required.
