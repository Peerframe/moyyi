# Native desktop modules acceptance

`native-modules.mjs` replaces **only** `Contents/Resources/app/worker.mjs` in a disposable copy
of a packaged app. It runs the real installed host, parser, SQLite, permissions and effects with
one deterministic four-request provider. It blocks network and credential access. It is never a
production worker and must not be copied into the daily app.

Use separate directories for the baseline and candidate, under a normal accessible location
such as `~/Applications/moyyi-desktop-modules-candidate/`. Do not place the app in the protected
`~/.moyyi` tree: the document parser deliberately cannot execute programs from that location.
Keep the main, preload, renderer and `host.mjs` bytes identical to the packaged candidate and
record their hashes before and after copying the worker. Use the packaged Node executable.

Create these directories before launching:

```text
moyyi-desktop-modules-candidate/
  Moyyi.app/              disposable app copied with ditto
  workspace/              initially empty
  external/               copies of public aster.pdf and birch.docx
  saved/                  native save-copy destination
  data/                   initially empty, never the daily store
  evidence/               fixture state, requests and acceptance screenshots
  home/                   isolated HOME for the app launch
```

Copy the source documents from `src/runtime/fixtures/documents/standard/eval/`. Their committed
manifest and `inputs.json` define the public contents. Put `qa-config.json` beside the replacement
worker, using actual absolute paths:

```json
{
  "mode": "synthetic-native-desktop-modules",
  "root": "/absolute/path/moyyi-desktop-modules-candidate",
  "workspace": "/absolute/path/moyyi-desktop-modules-candidate/workspace",
  "dataDirectory": "/absolute/path/moyyi-desktop-modules-candidate/data",
  "evidence": "/absolute/path/moyyi-desktop-modules-candidate/evidence"
}
```

Launch the copy's executable directly with normal macOS `HOME` and a dedicated
`--user-data-dir=<fixture>/chromium`; do not use LaunchServices, which may reuse another process.
The replacement worker isolates the store/settings and rejects credentials and network. Changing
`HOME` can disable the macOS Save panel and is not needed for isolation. Perform these operations:

1. Select `workspace/` and leave per-read approval off.
2. Import `external/aster.pdf` and `external/birch.docx` with the native document picker; confirm
   the import. Both originals must remain unchanged.
3. Select `workspace/modules-report.md` as the report destination. Do not enable general writes.
4. Send this exact task once:

   ```text
   QA modules: read selected PDF and DOCX, create modules-report.md with approval, then read it back.
   ```

5. Approve the prepared report creation. The fixture verifies both real parser observations,
   the report effect and its subsequent readback before producing its final answer.
6. Open the report preview and save a copy through the native save dialog into `saved/`.
   Compare the saved bytes and workspace report against `evidence/expected-report.md`.
7. Capture normal `1120×800` and existing native minimum `780×560` windows. The CSS-only
   `560 px` width can be checked separately; changing the native minimum would change behavior.
8. Quit the actual process, relaunch the same copy with the same isolated HOME, open the session
   from history and reopen the report. Inspect complete history. Do not send another task.

`native-counts.json` must show exactly four synthetic requests, zero network attempts and zero
credential reads. After restart, that request count must stay at four. `native-state.json` must
show read-only reopened grants, retained materials and the report preview backed by its recorded
receipt. `native-requests.json` contains only this public fixture's synthetic requests. Native
screenshots and interaction receipts remain separate evidence; running the worker without those
interactions does not establish native acceptance.

If UI automation cannot drag window edges, quit the disposable app and change only its copied
main bundle's initial `width: 1120` / `height: 800` to `780` / `560`. Record original/instrumented
hashes, keep the minimum and all other bytes unchanged, and restore the original after capture.
Use the same geometry-only setup for baseline and candidate, and label the evidence accordingly.
This never changes source or the packaged deliverable.
