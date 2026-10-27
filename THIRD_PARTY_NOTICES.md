# Third-party notices

## OpenBot: bounded YAML validation, document parsing and desktop presentation

`src/plugins/skills/parse.ts` adapts the bounded YAML AST-validation approach from
`packages/employee-publisher/src/agent-skills.ts`, OpenBot revision
`010439bb9002fabb7e1facd8450ee85edbafa309`. The moyyi schema checks and runtime integration are new.
`src/runtime/document-worker.ts` also adapts the PDF/Office extraction methods from
`apps/server-python/src/openbot_server/parser_worker.ts` at the same fixed commit. Two synthetic
PDF test fixtures (encrypted and image-only) are copied from that commit.
`apps/desktop/renderer/ApprovalCard.tsx` adapts its approval view's pending/error handling,
and `styles.css` adapts a small presentation/token subset, at the same fixed commit.
`apps/desktop/renderer/ArtifactCard.tsx` also narrowly adapts presentation, pending/error feedback
and the identity-only action pattern from `apps/web/src/components/ArtifactCard.tsx` and
`apps/web/src/artifact-shell-save.ts` at that commit. Its receipt/hash inspection, in-app text
preview and Finder request use moyyi's new local host boundary rather than the upstream Server.
`apps/desktop/renderer/EffectsPanel.tsx` and `effects-state.ts` narrowly adapt the long-list
folding and row presentation from `apps/web/src/components/TaskSteps.tsx` at that commit. Their
record identities, actual effect states, receipt inspection and draft-only undo are moyyi code;
the upstream progress-fetch lifecycle and Server types are not imported.
Bot/channel DTOs, Server authority and the old runtime are not imported. The desktop distribution
also carries `apps/desktop/renderer/OPENBOT-LICENSE.txt` under its Resources/licenses directory.
The source and fixtures are licensed under MIT:

Copyright (c) 2026 OpenBot contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Dependencies

The npm-installed dependencies retain their own licenses in their package directories. The Skills
parser adds `yaml` 2.9.1 (ISC), used through its public API rather than vendored source. Its exact
version and integrity are recorded in `package-lock.json`.

The desktop bundles Electron45.0.0, React/ReactDOM19.3.1 (MIT), and Node26.12.1 with their original
licenses, including Chromium's third-party notices. esbuild0.28.2 and React type declarations19.3.0
are build-time dependencies only. Exact integrity and reviewed choices are in the lockfile and
[ADR 0037](docs/decisions/0037-installed-desktop-client.md).


## officeparser Node distribution

The compiled candidate redistributes the Node files of officeparser 7.8.0 from
https://github.com/harshankur/officeParser (commit 09b27018450ed4df88fe01494343b43556813b71).
The original MIT LICENSE accompanies `dist/vendor/officeparser/`, together with original package
metadata and SOURCE.json. The sole metadata adaptation pins its PDF.js dependency to 6.3.289;
Node parser source files are unchanged. Browser bundles and the old SBOM are not included.

## Document codec dependencies

PDF.js / pdfjs-dist 6.3.289 is licensed under Apache-2.0; its installed package retains LICENSE
and the separate notices accompanying fonts, CMaps, ICC/WASM and other distributed assets.
Office's XML/ZIP/file-type dependencies retain their own MIT licenses. Tesseract.js 7.0.0 and
tesseract.js-core 7.0.0 (Apache-2.0) remain transitive dependencies even though OCR is disabled.
No OCR language package is added. Optional canvas platform dependencies retain their package
licenses. `package-lock.json` fixes the source closure; candidate installation verifies the actual
closure and keeps these original dependency licenses. No upstream copyright is transferred to moyyi.
