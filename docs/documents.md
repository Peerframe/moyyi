# Read documents

`read_document` extracts body text from local `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`
and `.odp` files. It is enabled by default under the existing workspace read permission. A trusted
host can set `documents: false` to omit it. CLI `--approve-reads` includes document reads; no shell
permission is required. Adding document reading does not grant workspace writes or network access.

Place a supported file inside the selected workspace and ask moyyi to read it, for example:
“Read `documents/brief.docx`; summarize its deadlines and quote the supporting extracted lines.”
This uses the configured model and may incur its normal API cost. No live call is part of the
feature's offline verification. The tool accepts only:

```json
{ "path": "documents/brief.docx", "startLine": 1, "maxLines": 200 }
```

`path` is relative to the workspace. Lines start at 1; the default window contains 200 lines and
at most 1,000 may be requested. These are **extracted text lines**, not PDF pages, slide numbers,
original Word paragraphs or spreadsheet cell coordinates. The result identifies the normalized
source path, format, complete input byte count and SHA-256, extracted line range and coverage.
Body text is separate from the metadata, with numbered lines. A hash identifies the exact snapshot
read; it does not promise that the file has remained unchanged afterward.

Window/output truncation and extraction limits are separate. A continuation points to unread
extracted lines where possible; reaching an extraction limit cannot be bypassed by requesting a
later window. A partial final line is marked. An over-budget first line reports `output_line_limit` instead of
recommending an identical, non-progressing read. Very small output budgets fail without returning
body text stripped of provenance. The original tool output budget remains in force.

## Scope and limits

| Boundary | Limit |
|---|---|
| Complete source snapshot | 10 MiB |
| PDF pages visited | 200 |
| Office expanded ZIP bytes | 32 MiB |
| ZIP entries | 2,000 |
| Materialized table cells | 100,000 |
| XML structural validation | 250,000 tags, depth 128 |
| Extracted text | 262,144 UTF-16 units |
| Parser process deadline | 30 seconds |
| Parser protocol output / diagnostics | 2 MiB / 64 KiB |

The parser uses a 256 MiB old-generation heap and 32 MiB young-generation limit; these are **not**
an OS-level RSS limit. CPU work is bounded by the deadline. Denial, cancellation and permission
revocation stop the parser and discard its result. Unconfirmed shutdown is never reported as a
successful extraction.

Scans/image-only pages return no readable body text; OCR is disabled. Empty, encrypted, damaged,
unsupported, over-limit and failed parsing have separate errors. Decrypt encrypted documents
outside moyyi first: there is no tool password field, so passwords need not enter model requests
or session records. There is no raw XML, binary upload or garbage-text fallback.

Legacy `.doc/.xls/.ppt`, macros, OCR, attachment recursion and format conversion are unsupported.
Office XML must use UTF-8 (BOM allowed); other encodings return a specific unsupported error.
Unsupported spreadsheet structures that could make comment/CDATA/processing-instruction content
look like real rows are rejected explicitly, without publishing a partial or invented body.
Text extraction does not calculate formulas, interpret charts, reproduce layout or guarantee visual
reading order. Existing cached spreadsheet values are document data, not newly calculated results.
PDF text coverage explicitly reports visited pages, independently from extraction line positions.

## Isolation and installation

Runtime opens a guarded regular-file descriptor and reads a complete bounded snapshot before
launching a fixed byte-to-text process. The plugin receives neither bytes nor filesystem/process
APIs. Parsing uses native macOS Seatbelt or Linux bubblewrap, with a fresh environment, private
scratch space, fixed Node/parser dependencies and no workspace or network grant. A missing or
broken sandbox makes this tool unavailable; ordinary text tools remain usable. Existing same-user
filesystem races and host-SIGKILL limitations are not claimed solved by this feature.

The selected codecs are PDF.js **6.3.289** and officeparser **7.8.0**. The npm candidate carries a
generated `npm-shrinkwrap.json` derived from the sole source `package-lock.json`. Local-tarball
installation in the tested npm version did not honor the nested shrinkwrap on its own: therefore
the candidate also carries the unchanged Node distribution of officeparser, with only its package
metadata's PDF dependency corrected to 6.3.289. The original metadata, license, integrity and
per-file hashes accompany the copy. Installation checks resolve PDF.js from both entry points and
compare the dependency graph. See [the decision](decisions/0028-bounded-document-reading.md) and
[reuse record](openbot-provenance.md).

Tesseract.js and its core remain transitive Office dependencies. No OCR language package is added,
and neither OCR nor language downloads are enabled. The copied Node distribution excludes browser
bundles containing an independent PDF implementation. No upstream agent SDK or OpenBot runtime
is imported.

## Verification and live acceptance

`npm run eval:documents` uses the real runtime, native parser, SQLite and synthetic documents with
a scripted model. It checks that document evidence reaches the next request and that an explicitly
write-enabled temporary task can create and re-read a report. `npm run verify:package` repeats
seven-format reads and native isolation outside the source tree through an installed tarball.
These checks prove plumbing and boundaries, not model understanding.

On 2026-10-26, the owner authorized real document acceptance and removed the total request cap
for that document work. The first frozen baseline retained four requests per task: both fixed
checkers passed on the installed candidate with actual comparison/report files, exact quotations
and hashes, correct approved-only totals, readback and unchanged sources. Eight HTTP 200 requests
were used, with no retries. Each task first attempted shell and was denied, then completed through
the authorized file tools. This is one run of each small fixed task, not a general reliability claim.
See the [acceptance record](tasks/2026-10-26-optimization-plan.md#文档真实任务验收2026-10-26).

The separate original regression group remains original source4 + public4 with unchanged rubrics;
those historical failures are not overwritten by document success. No old exhausted budget is
reused. The fixed document tasks are described with the [existing runtime evaluation](runtime-evaluation.md).
