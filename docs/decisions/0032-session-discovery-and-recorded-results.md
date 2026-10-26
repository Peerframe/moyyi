# ADR 0032: Find previous work and inspect recorded results

Date: 2026-10-27. Status: implemented; integration and installation tracked in the system overview.

## User outcome and whole-system diagnosis

A useful personal agent must let its owner return to work after closing the terminal. Storage,
recovery, approved file snapshots and live effect receipts already exist, but the CLI requires a
previously saved session ID. History replay shows tool status without making the corresponding
file path, snapshot or process exit easy to retrieve. This gap is between durable execution and
the human client; changing the model prompt or retrieval tools would not solve it.

Keep separate evidence about model quality. Earlier complete-source interpretation mistakes and
the public release-note omission remain failures; a successful history view cannot improve those
scores. This delivery completes one daily workflow: discover a task, inspect actual recorded
effects, and resume under the current host's permissions.

## Reference and choice

OpenCode's reviewed v1.19.4 source at
[`148842ef7cb1bc34192b3fff57d0f9721ab9c801`](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/cli/cmd/session.ts)
provides a bounded session list with identifiers, titles and activity, with table/JSON views.
This supports making persisted work discoverable through the existing CLI. We reuse the product
pattern, not its source, storage schema, UI stack or generated-title mechanism. No source is
copied or substantially adapted and no dependency is added.

Use moyyi's existing local client protocol, SQLite session/entry index, transcript and effect
journal. A GUI, new history service or model-generated summaries would add independent work
without solving an additional requirement in this slice. An optional store catalog method keeps
custom stores compatible with existing recovery/resume; unsupported catalogs report that limit.

## Contract and authority

- Add nonpersisted `session.list`/`session.results` commands and `session.listed`/`session.results`
  events. They are trusted local-host inspection, never model tools or context sources. No disk
  schema, persisted v1 record, core loop or permission policy changes.
- Catalog pages come from the selected private store, across its workspaces. They contain bounded
  user-prompt excerpts rather than invented titles. Order is the latest recorded entry ordinal,
  then session ID; empty sessions have no fabricated activity timestamp. Query existing indexes
  and fetch one bounded page instead of loading every transcript/blob.
- Result pages use the existing validated session read. Match effect and tool result by session,
  run and call identity; ambiguous, missing or foreign results cannot produce a receipt.
  Assistant claims and read content never count. Preserve denied, failed and unknown states.
- Share the existing bounded receipt extraction between current and historical views. File paths,
  snapshot IDs and command termination are recorded facts, not proof of current file contents,
  valid undo preconditions or task correctness. Exit code zero alone is not a verified check.
- Inspection is idle-only, leaves the selected session and approvals untouched, creates no model
  request and grants no capability. Resume continues to use the current host's authority. Never
  replay an old approval or action from the history view.
- Protocol pages default to 20 records, at most 50, offset at most 10,000. CLI pages contain 20
  records. Results reuse a full-session load: bounded presentation is not a claim of bounded
  full-history I/O. No historical-content search, rename, delete or export in this slice.

## Finite acceptance

Create work in one workspace, close the runtime/process, start in a second workspace, discover the
first session without supplying its ID at launch, inspect matching file/snapshot/process records,
and resume without a model request, action replay or restored grants. A subsequent write under a
readonly host must remain denied. Include forged prose, cross-run call IDs, missing results,
terminal controls, paging, empty sessions, custom-store failures, close/reload/busy races and
unchanged transcript checks. Exercise actual SQLite and an outside-checkout installed CLI/client.
These checks establish the client workflow; they do not claim improved model reasoning.

Source acceptance passed: `npm run check` (109 files, 2,350 tests),
`python3 scripts/verify-cli-pty.py` (7/7, including cross-workspace restart),
`npm run eval:long-sessions` (4/4) and `npm run eval:writes` (8/8).
Independent boundary/lifecycle review found no blocker. The first new integration assertion
incorrectly expected an effect for a before-prepare denial; the recorded denied tool result
and unchanged bytes are the correct existing contract. The first new PTY close check did not
drain terminal output; it now uses the existing five-second drain/exit pattern. Both initial
failures are retained privately; no production contract, threshold or timeout was relaxed.
