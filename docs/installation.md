# Install a local candidate

Phase 6 prepares an installable CLI and programmatic package. This is a **local development
candidate**, not an official release. No npm publication, GitHub Release, tag, signed installer,
registry name reservation or automatic update is performed. The package retains `private: true`
and version `0.0.0`; the tarball SHA-256 and source revision identify a candidate.

## Requirements

- Node.js 26 and npm 11 or newer. Candidate acceptance runs on macOS and Ubuntu Linux; Windows
  installation is rejected by the package OS field. Other operating systems/architectures are
  not certified by these checks.
- Dependencies must be obtainable from npm or an existing cache. The tarball does not bundle
  Node.js. The candidate carries the reviewed Office Node distribution and a generated shrinkwrap;
  other production packages come from npm/cache. The install gate checks actual dependency
  resolutions against the source lock, including Office's PDF.js. See [document packaging](documents.md).
- Shell and document parsing additionally need the existing native sandbox: macOS Seatbelt or Linux bubblewrap
  with the required user-namespace policy. Installing moyyi does not install or enable those OS
  facilities. Document parsing needs no shell grant; ordinary text reading and the offline demo
  remain available if the document sandbox is unavailable. See [shell limits](shell.md).

## Build and verify from the repository

```sh
npm ci
npm run check
npm run verify:package
```

`verify:package` creates a clean compiled npm tarball, validates its complete file list, installs
that exact file into disposable local and global-prefix consumers outside the repository, and
runs CLI, terminal, public-client and TypeScript checks, seven-format document reads, a scripted
document-to-report write/readback workflow, native parser isolation probes and exact parser dependency checks. Install scripts are disabled; npm may fetch
the pinned production dependencies and their transitive dependencies from the public registry.
The acceptance programs make no model or web requests. Existing user/global installations and data
are untouched. Python 3 is needed for the existing POSIX terminal acceptance script; it is not a
product runtime dependency. If package metadata and tarballs are already cached, use
`npm run verify:package -- --offline` to require offline installation. A fresh `npm ci` cache alone
is not sufficient: it may have tarballs without the metadata needed for a new consumer install.

The command prints the artifact path in `artifacts/`, a SHA-256 sidecar, a file/revision manifest
and, on success only, an `.acceptance.json` receipt. A dirty-worktree candidate is labeled dirty.
The receipt applies to that artifact and host, not all future source versions or live providers.
`npm run package:candidate` only builds/packages and does not establish installation acceptance.
Direct `npm pack` also performs a clean build; use the verification command for the complete gate.

## Install the tarball

Use the exact artifact path printed above. A project-local install is:

```sh
mkdir -p /absolute/private/moyyi-client
cd /absolute/private/moyyi-client
npm init -y
npm install --ignore-scripts /absolute/path/to/moyyi-0.0.0-HASH.tgz
./node_modules/.bin/moyyi --help
```

For a command in an explicitly chosen user-owned prefix:

```sh
npm install --global --prefix /absolute/private/moyyi-prefix --ignore-scripts /absolute/path/to/moyyi-0.0.0-HASH.tgz
/absolute/private/moyyi-prefix/bin/moyyi --version
```

These commands install a file, not an npm package selected by name. Use `--offline` if all
dependencies are already cached. Compare the artifact with its `.sha256` sidecar before moving
it between machines; a checksum detects changed bytes but does not establish publisher identity.
No compiler, repository checkout or source `.ts` execution is needed by the installed CLI.

Try the offline script with a disposable workspace containing a README:

```sh
/absolute/private/moyyi-prefix/bin/moyyi --demo -C /absolute/workspace --data /absolute/private/demo-data
```

The demo has 32 scripted read/answer pairs; it is not an intelligent model. Live operation uses
the existing explicit `--host /absolute/private/host.mjs` configuration. See [CLI](cli.md),
[DeepSeek](deepseek.md), [Anthropic](anthropic.md), [documents](documents.md) and [web](web.md). Paid requests still require
your deliberate model connection and tasks. Installation does not discover credentials, enable
tools, relax approvals or prove remote API compatibility.

Installed modules expose `moyyi/runtime` and `moyyi/contracts` for a trusted local client or host;
see [client protocol](client-protocol.md). Place a host that imports these package entry points
under the consumer project that contains `node_modules/moyyi`, so Node can resolve them. A global
CLI install alone does not add a package to unrelated host modules' import search path.

## Upgrade or remove a candidate

Stop running sessions first. Back up your data using the documented storage workflow before an
upgrade; candidate validation does not establish arbitrary downgrade compatibility. Installing a
new local tarball into the same selected prefix replaces the application, not the data directory.
Keep the previous tarball if you need to inspect it. Do not run two writers against the same data.

When CLI and desktop share a store, upgrade both to compatible runtimes before reopening either.
M6 migrates schema1/2 to schema3; the earlier schema2 CLI and M5 desktop refuse that database.
Retain both previous programs and their pre-upgrade data backup as one rollback set. A software-only
downgrade cannot read schema3, and restoring old data deliberately replaces newer history, so first
preserve the current store separately. Host configuration and model defaults need not change.

Delivery one's output-spill candidate also upgrades persisted transcript format 1 to format 2,
while keeping SQL schema 3. Old CLI/desktop programs reject format 2 even though the schema number
matches. Upgrade the paired programs together. To return to an old program, first rescue the
current store, then use the matching pre-upgrade data backup and programs. Rollback checks both
schema and persisted format; it never drops output references to manufacture compatibility.
Restoring a format 1 backup migrates a private copy and leaves that backup unchanged. See
[ADR 0046](decisions/0046-recorded-tool-output.md).

Delivery three upgrades desktop settings separately from the conversation store. Existing
format 1 settings are read without changing the original file. The first settings save writes
format 2 and retains the original as `~/.moyyi/desktop/settings.format1.json`, without replacing
an existing copy. Format 2 records connections and credential references, the search connection,
personal-instruction hash and the confirmed Skill library index; API keys remain in Keychain.

Desktop backups include the settings file, confirmed personal instructions and every indexed
Skill version, including disabled versions. The manifest records each file's size and SHA-256.
Unconfirmed imports are not part of the library. Backups reject missing, oversized, linked,
publicly readable or hash-mismatched preference files. The existing manifest format and
conversation-store format are unchanged by these additions.

Restore continues to replace only the conversation store. It preserves current connections,
personal instructions and Skills, and first saves a complete rescue backup containing those
current files. A backup's preference files are validated but never silently applied to the
desktop. Software rollback checks both the target's declared settings format and the store's
schema/persisted-format pair before preparation and again before replacement. An older program
that cannot read settings format 2 or persisted format 2 is refused. Keep the corresponding
pre-upgrade settings/data backups and programs together; neither rollback nor restore drops
connections, Skills or new records to make an older version compatible.

```sh
npm uninstall --global --prefix /absolute/private/moyyi-prefix moyyi
```

For a project-local installation run `npm uninstall moyyi` in that consumer. Neither operation
deletes separate `--data` directories or `~/.moyyi/data`. Remove those only by a separate deliberate
data-deletion action. Usage guides in the package are a subset; architecture, ADR, research and
historical links refer to the full [repository documentation](https://github.com/Peerframe/moyyi/tree/main/docs).
