# Explicitly enabled Skills

moyyi can load Agent Skills guidance from a library you choose. Skills are text, with no permission
to write files, run commands, access the network or bypass approvals. Enabling a skill does not
install software or execute its scripts. The desktop candidate imports reviewed immutable copies
and lets the model read explicitly enabled versions on demand. The existing CLI loads named
files from a trusted host-selected directory. Neither path discovers arbitrary Skills or lets
the model activate a version.

## Desktop library (delivery three candidate)

Open **个人指令与 Skills → 从本机导入** and choose a directory containing `SKILL.md`.
The folder name must match the document's `name`. Review its name, description, SHA-256 and full
text before **确认导入**. The omitted-files list is bounded and marks truncation. Only the reviewed
`SKILL.md` bytes are copied; links, references, assets and scripts are neither read nor imported.
Cancelling review creates no library entry. Import itself makes no model request and leaves the
new version disabled.

Choose **启用此版本** to expose its name and description to the model. At most 8 versions can be
enabled, with one per name; enabling another digest for the same name disables its predecessor.
The library stores at most 32 imported versions. Copies live at
`~/.moyyi/desktop/skills/<sha256>/SKILL.md`, with private directories and a read-only file. Editing
the original folder does not change a copy: inspect and import the new version explicitly.
Symlinked directories/files, hardlinked or special files, invalid UTF-8 and oversized documents
are rejected. There is no remote installation, directory scan, file watcher or script runner.

Each request gets a summary-only catalog after its recorded history. Descriptions normalize
whitespace and are capped at 256 UTF-8 bytes each; the whole catalog is at most 4096 bytes.
The prompt tells the model to call `read_skill({"name":"code-review"})` before using matching
guidance, rather than infer its full instructions from the summary. A successful read returns
the name, verified SHA-256 and complete original document as a recorded tool result, with no
absolute library path. A file that cannot fit the tool-output limit is not claimed as loaded.
Read policy and cancellation still apply; importing or enabling grants no ordinary file, process
or network capability. `allowed-tools` remains inert metadata.

**撤销** removes the version from future catalogs. An empty enabled library is explicit. The
reader binds the selected name and digest, checks availability before and after the read, and
fails if the version is revoked or replaced. It cannot return a cached body after revocation.
Already recorded requests and tool observations are retained; revocation does not erase text
the model previously received. All enabled guidance is potentially sent to the selected provider.

The catalog is a request suffix, not a new transcript entry. Changes preserve the preceding
system/history prefix and old request blobs, but old catalog tails are not accumulated for later
cache reuse. Tool-loaded bodies remain normal history. These are implementation guarantees;
actual instruction following and provider cache hits require separate evidence. See
[ADR 0049](decisions/0049-personal-instructions-and-skill-library.md) and the
[plugin model experience](../src/plugins/skill-library/README.md).

## Configure an explicit CLI skill

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

## CLI access and interpretation

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

## Shared document format and limits

This is a bounded subset of the [Agent Skills specification](https://agentskills.io/specification):
YAML 1.2 frontmatter between `---` lines, then a non-empty Markdown body. Required `name` must match
the selected folder, use ASCII lowercase letters/digits separated by single hyphens, and be at most
64 characters; `description` must be a non-empty string of at most 1024 characters. Optional
`license`, `compatibility`, `metadata` and `allowed-tools` are accepted. Unknown fields are rejected.
Unicode skill identifiers and empty body documents are outside this first profile.

- Each complete document is at most 12 KiB. The CLI accepts at most 8 distinct enabled names
  and 48 KiB skill text per collection. Alongside root AGENTS.md's 16 KiB, its automatic source
  text is at most 64 KiB. Desktop catalog and library limits are listed above. The
  existing whole-request context budget also applies, including JSON framing, history and tools;
  no skill is silently truncated or dropped to make a request fit.
- Frontmatter: 4 KiB, at most 256 YAML nodes and depth 8. No aliases, anchors, tags, directives,
  duplicate keys, non-string mapping keys or prototype-related keys. String scalar semantics use
  the mature `yaml` package, including quoted/block/folded values; numbers/booleans are not coerced.
- Optional `license` and `compatibility`: non-empty strings, at most 500 characters;
  `allowed-tools`: non-empty string, at most 1024. `metadata`: at most 32 non-empty string pairs,
  key length at most 100 and value length at most 500. These are local limits, not claims that
  every standard-compatible skill uses them. Unsupported control characters are rejected.
- For CLI selection, the library root and selected directory must be real directories; SKILL.md
  must be a regular single-link file. No final-root, skill-directory or file symlinks, hardlinks or special files.
  Private runtime/store/recording paths, configured protected paths and secret-name paths remain
  blocked. OS aliases in root ancestors (such as macOS `/var`) follow the existing reader rules.
- A CLI-enabled file is read even if `.gitignore` excludes it: ignore rules are discovery
  hints, not permissions. Missing, unreadable, invalid or oversized enabled files fail before the
  model request; remove/fix the selected file instead of relying on an empty fallback.

The CLI capability expires after context collection and follows cancellation, policy revocation and
other context-source failure. File identity and metadata checks reduce replacement races; they do
not isolate against a hostile process running as the same OS user. Hashes identify collected text,
not trust or approval. The offline suite exercises these boundaries with synthetic files/models;
it does not prove that a live model follows every instruction. Delivery-three installed and live
acceptance remain separate from those tests.
