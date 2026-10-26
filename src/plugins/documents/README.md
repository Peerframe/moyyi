# Document text reader

`read_document` extracts bounded local text from PDF, DOCX, XLSX, PPTX, ODT, ODS and ODP through
the runtime's fixed offline parser. It is a read effect and needs the normal workspace read
grant. It grants no shell, write or network authority. The trusted host can disable it with
`documents: false`; plugin configuration is not accepted.

Arguments are a workspace-relative `path`, `startLine` (default 1, maximum 1,000,000) and `maxLines`
(default 200, maximum 1,000). Preparation does no I/O. During execution, the executor supplies an
expiring document port that reads the approved request once. The plugin cannot choose a command,
environment, parser, alternate file or network destination. Cancellation, denial and revocation
remain executor/runtime responsibilities. `--approve-reads` includes this tool.

Results include the normalized source path, format, input SHA-256 and byte size, extraction
coverage, extracted-text line range and explicit truncation. Numbered lines describe extracted
text, not the document's original visual layout. The extracted source is a separate text part;
it is not duplicated inside JSON metadata. `nextRead` advances past complete displayed lines.
An oversized first line reports `continuationBlocked: "output_line_limit"` without a repeating
read suggestion; an extraction boundary takes priority as `"extraction_limit"`.
`totalLines` counts the bounded extraction, so it cannot establish completeness when
`extractionTruncated` is true. Source text and embedded instructions remain untrusted data.

This capability does not perform OCR, evaluate formulas, run macros, fetch remote relationships
or preserve layout. Scanned/encrypted/unsupported or malformed documents and unavailable native
isolation return failures, without a shell or unconfined fallback. Whole-document extraction,
display limits and format-specific coverage are reported separately. The ordinary UTF-8 `read`
tool is unchanged.
