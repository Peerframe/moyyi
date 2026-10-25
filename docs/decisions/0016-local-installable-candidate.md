# ADR 0016: a local installable candidate before publication

Status: implemented on the phase 6 branch; new PR awaits review. Official publication is not
authorized. Accepted D1–D6 and the existing runtime/security boundaries remain unchanged.

## Decision and evidence

Use the existing TypeScript compiler and npm tarball format. Keep `private: true`, version
`0.0.0`, exact direct dependency versions and the current Node 26 / npm 11 toolchain. No SDK,
bundler, installer service or new dependency is added. Reviewed/tested tool versions are Node
26.0.0, npm 11.12.1 and TypeScript 7.0.2; the latter remains pinned by ADR 0004.

The [npm manifest reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
documents `files`, mandatory manifest/readme/license/bin entries and the private publication
guard. A `files` allowlist includes compiled production code and explicit usage guides. A second
check compares every packed path against expected production compiler outputs, rejecting missing,
duplicate, stale or extra files. Clean builds exclude tests and provider/persisted fixtures; maps
include their public source so diagnostics do not require unpackaged source files. No private
corpus, task logs, credentials, installed dependencies or repository-only scripts are packed.

[npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/) supplies the local archive and JSON
inventory. Its [prepack lifecycle](https://docs.npmjs.com/cli/v11/using-npm/scripts/) runs a clean
build before packing. There is no prepare/install hook: an installed artifact must work without
TypeScript or repository files. This stage neither invokes `npm publish` nor creates a tag/Release.

[Node package exports](https://nodejs.org/api/packages.html) define two ESM entry points:
`moyyi/runtime` and `moyyi/contracts`, with declarations. Runtime also exports the existing host
recording helpers, API-profile constants and policies, so installed hosts need no source-path
imports. Internal modules stay unexported; this defines the API surface, not an OS security
boundary. The existing command/event protocol remains in-process and trusted-host-only. No
remote transport, GUI, auth service or new persisted format is introduced.

## Alternatives and tradeoffs

- A bundler could reduce file count, but adds toolchain/dependency-resolution behavior without
  solving the current missing install verification. Compiled ESM plus existing dependencies is
  sufficient and keeps module boundaries inspectable.
- A Node single executable or platform installer could remove the Node prerequisite, but adds
  native-platform build, dependency, signing and distribution work. That is a separate future
  release choice, not required for a reviewable CLI candidate.
- Publishing to a registry would make installation shorter, but is explicitly excluded by the
  owner. An npm package name, release version, registry, signing and distribution policy remain
  future release decisions. A tarball checksum identifies bytes; it is not publisher authentication.

Third-party dependencies are not bundled. Exact direct versions are unchanged; their transitive
constraints still affect new installations. The acceptance receipt records the resolved dependency
tree. A fully frozen or bundled distribution requires a later release decision; no bit-reproducible
cross-platform install claim is made.

## Acceptance and limits

`npm run verify:package` creates a candidate, verifies its inventory/hash, and uses npm's
[local tarball installation](https://docs.npmjs.com/cli/v11/commands/npm-install/) in temporary
project and global-prefix directories outside the repository. Install scripts are disabled. The
verification compiler/cache are contributor tools; runtime processes get a clean PATH, no
`NODE_PATH` or ambient Node options, and resolve the actually installed package. CLI, real PTY,
programmatic protocol, strict independent TypeScript and uninstall checks inspect observable
results, real files and SQLite. Temp directories are cleaned even on failure. Artifacts and receipts
remain local and ignored; a failed candidate has no passing receipt.

macOS evidence is local and Linux evidence runs in the existing CI job. Windows installation is
excluded; other architectures and OS versions are unverified. OS sandbox dependencies remain
separate, not silently installed or bypassed. Live model/provider, SearXNG, held-out competence
and prompt-injection quality are not established by scripted package acceptance. Earlier gaps,
including the planned `project-instructions` plugin, remain explicit.

No upstream/OpenBot source was copied. Existing moyyi CLI/PTY checks, provider contracts and
runtime guarantees are reused. See [installation](../installation.md),
[client protocol](../client-protocol.md) and [current handoff](../tasks/2026-10-25-phase-6-candidate.md).
