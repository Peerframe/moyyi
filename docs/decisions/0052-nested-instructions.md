# ADR 0052: Nested AGENTS.md from directories the session worked in

- Date: 2026-11-05
- Status: accepted by the owner as part of the Claude Code–level roadmap (extensions). Extends
  [ADR 0017](0017-working-and-project-instructions.md), which loads only the root file.

## Context

Root `AGENTS.md` loads automatically; nested files had to be found and read by the model with
ordinary tools, which it does not reliably do. Claude Code and Codex load the instructions of
subdirectories they work in. Anything the model sees must stay reconstructable from records.

## Decision

- **Opt-in**: `RuntimeOptions.nestedInstructions` (CLI `--nested-instructions`). It only works
  with root project instructions enabled.
- **Which directories**: before each request, the runtime derives directories from the
  session's recorded tool calls of `read`, `list`, `search`, `create`, `edit`, `undo` and
  `read_document`: a file's parent directories, or the listed/searched directory and its parents.
  Only relative paths without `..`, absolute paths or backslashes count; at most 64 directories,
  in order of first use, parents before children. Shell commands do not count.
- **Which files**: `<directory>/AGENTS.md` for those directories, read with the root file's rules:
  the read grant plus an automatic-context-read decision per path, a regular file with one link,
  no alias anywhere on the directory path, complete UTF-8 text up to 16 KiB. At most 8 files and
  32 KiB in total per request; absent files are skipped.
- **What the model sees**: one `turn` section `project-instructions.nested` after the root
  section, with a fixed scope statement (each file applies only under its scope; the nearest scope
  wins over broader guidance; explicit user instructions and safety boundaries win over all) and
  a JSON list of `{path, scope, sha256, text}`. A file that cannot be read safely appears as
  `{path, scope, unavailable}`: its rules are unknown, not absent.

## Consequences

- Guidance arrives one request after the model first works in a directory, not before.
- The section changes when a new directory is touched or a file changes, which invalidates the
  prompt cache from that section on; root and earlier sections are unaffected.
- Like the root file, nested guidance cannot grant permissions; it is project text.

## Rejected

- Scanning the whole workspace for `AGENTS.md`: unbounded and loads guidance for code the task
  never touches.
- Following symlinked directories or files: an alias could pull guidance from outside the
  workspace.
