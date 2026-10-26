# ADR 0028: bounded document reading through a dedicated runtime capability

- Status: accepted implementation of the owner's seven-format plan
- Date: 2026-10-26
- Scope: document reading and offline task preparation; no paid calls or public release

## Decision

Add the `documents` plugin and `read_document` tool. Extend only nonpersisted contracts with
`ToolContext.documents` and its factory. The core supplies this port only during execution of an
authorized `read_document` read effect, after durable start. The port is single-use and takes no
arguments: runtime clones and validates the already bound action. Preparation validates parameters
without reading bytes or starting a parser. `documents: false` disables registration; CLI
`--approve-reads` includes this tool. No generic process grant or workspace write grant is added.

Runtime alone reads the complete bounded source through the existing guarded descriptor discipline,
checks identity before/after reading, hashes the snapshot and sends bytes to one fixed parser.
Neither the plugin nor the model receives the binary. The parser process has a native Seatbelt or
bubblewrap boundary, a fresh environment and a private scratch directory. It receives fixed Node
and codec dependencies but no workspace, user home, credentials or network access. No unsandboxed
fallback exists. Parser failure does not remove ordinary text capabilities. A deadline, output caps,
cancel/revocation polling and confirmed process-group termination bound its lifetime.

Body text and metadata are separate tool-result text parts. Source SHA-256, byte size, normalized
path, format, extracted line range and extraction coverage are retained. Extraction positions never
pretend to be original pages or spreadsheet coordinates. Window/output truncation and extraction
limits remain distinct. Content is untrusted evidence with no authority. Persisted v1 is unchanged.

## Codecs and evidence

Use [PDF.js 6.3.289](https://github.com/mozilla/pdf.js/releases/tag/v6.3.289), release commit
`1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56`, and [officeparser 7.8.0](https://github.com/harshankur/officeParser/blob/09b27018450ed4df88fe01494343b43556813b71/package.json),
commit `09b27018450ed4df88fe01494343b43556813b71`. The accepted plan had already selected these
versions; implementation inspected their installed Node source and tested actual bytes. PDF.js 6.3
has removed the old `isEvalSupported` option; retaining a nonexistent option would give no guarantee.
The adapter reads text content only and never evaluates document actions. OCR/attachments are off;
Tesseract.js/core remain accurately disclosed transitive dependencies, without language packages.

The PDF/Office byte-to-text approach is narrowly adapted from OpenBot commit
`010439bb9002fabb7e1facd8450ee85edbafa309`, `apps/server-python/src/openbot_server/parser_worker.ts`.
New moyyi code owns the plugin, scoped port, guarded snapshot, sandbox, supervision and presentation.
No attachment service, server identity, database, cluster or old runtime is imported. Provenance and
MIT notices are retained; OpenBot's old results do not count as moyyi acceptance.

Limits: 10 MiB input; 200 PDF pages; 32 MiB actual Office inflation; 2,000 entries; 100,000 cells;
262,144 UTF-16 text units; 30-second parser deadline. Office preflight checks complete ZIP metadata,
actual inflated sizes and CRCs, XML validity and cell counts. This is necessary because the pinned
upstream can recover malformed spreadsheet XML and only applies its table expansion cap to ODF.
XML validation also bounds depth to 128 and markup to 250,000; non-UTF-8 Office XML and
spreadsheet special blocks that mimic rows/cells are explicitly unsupported. The process heap
limit is not a hard RSS guarantee. Errors are bounded categories, never raw parser
exceptions, XML or binary fallback. Passwords are not accepted by any tool/protocol field.

## Local candidate dependency closure

[npm's shrinkwrap documentation](https://docs.npmjs.com/cli/v11/configuring-npm/npm-shrinkwrap-json/)
describes a publishable lock. [Root overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides)
do not govern a package consumed as a dependency. Development therefore pins PDF.js 6.3.289 and
uses the source override, but installation must independently prove Office resolves that version.

Actual offline consumer experiments with npm 11.12.1 found that the local tarball path did not
honor nested shrinkwrap as expected and attempted officeparser's declared PDF.js 6.1.200. Correcting
only the generated lock edge or adding `_hasShrinkwrap` did not resolve this. The old version was
not fetched. The source of this behavior was inspected in the installed npm/pacote/Arborist code;
this is a local candidate finding, not a claim about every registry-published package or npm version.

The bounded adjustment is to copy the pinned officeparser **Node distribution without source
changes** into the compiled candidate. Only its package metadata's PDF dependency changes from
6.1.200 to 6.3.289. The original package metadata, MIT license, npm integrity and per-file SHA-256
inventory are shipped alongside it. Browser bundles, which embed a separate PDF implementation,
and the stale upstream SBOM are excluded. The source build still uses the exact locked upstream
package. Production codec dependencies are pinned explicitly; no platform-specific node_modules
snapshot is copied. `npm-shrinkwrap.json` is generated from the sole source lock before packing and
removed afterward so it cannot silently supersede contributor `package-lock.json`.

The independent install gate checks the real dependency resolutions against the canonical lock,
verifies both PDF entry paths, compares vendored Node bytes and runs real parsers and confinement
outside the source tree. Any graph drift fails acceptance. The exit condition for this metadata-only
copy is an upstream release with the required PDF edge plus a verified local installation path;
then remove the copy in one separately reviewed update. No agent SDK is introduced.

## Validation and limits of the claim

Unit/conformance checks cover seven real generated formats, ciphertext/image-only PDFs, empty and
corrupt containers, limits, source replacement, permission phases, cancellation/revocation and
parser shutdown. Actual package tests require successful parsing as well as denial probes on macOS
and Linux. Broken startup cannot count as confinement success. Scripted runtime tasks check exact
next-request evidence, report creation/readback, write denial, final request `none` and SQLite reopen.

Two fixed document tasks are prepared separately from the original 32-task corpus. They require
actual report files, correct facts/calculations, quotes/hashes and unchanged documents. Reference
and near-miss tests validate these checkers; they are not model task results. Future paid groups
remain separately authorized (original 4+4; document 4+4), Flash + Responses + low, zero retries.
Existing failed live outcomes, task rubrics and exhausted budgets are retained. Training, GUI,
MCP, memory, OCR and later daily-work expansion remain outside this slice.
