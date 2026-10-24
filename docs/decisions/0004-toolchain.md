# 0004: Toolchain

Status: accepted (2026-10-24)

## Decision

- TypeScript on Node.js 26, one repository, one package, ESM.
- Node 26 runs `.ts` sources directly (type stripping is stable there), so `erasableSyntaxOnly`
  is on and imports use `.ts` extensions; `tsc` rewrites them for the build.
- npm ≥ 11, which Node 26 bundles. `.npmrc` sets `engine-strict` so an older Node fails at install
  instead of at some later step.

## Why Node 26

From the official schedule (`nodejs/Release` `schedule.json`, read 2026-10-24):

| Version | Active LTS from | Maintenance from | End of life |
|---|---|---|---|
| 22 | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 24 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| 26 | 2026-10-28 | 2027-10-20 | 2029-04-30 |

Node 22 was chosen first by mistake (it was the local default) and reaches end of life about six
months after this project started. On Node 26.0.0, checked locally: `node:sqlite` is at
stability 1.2 (release candidate) and loads without an experimental warning, versus experimental
with a warning on 22.23.2; TypeScript type stripping is stability 2 (stable). The full check
suite passed on Node 26 without code changes.

## Pinned versions (reviewed 2026-10-24)

| Package | Version | Released |
|---|---|---|
| typescript | 7.0.2 | 2026-07-08 |
| vitest | 5.0.3 | 2026-09-30 |
| @biomejs/biome | 2.5.15 | 2026-09-30 |
| @types/node | 26.6.4 | 2026-10-01 |

Versions at least two weeks old were preferred over the newest release. npm 10.9.8 failed to
resolve Vitest's peer dependencies (`Cannot read properties of null (reading 'edgesOut')`); npm 11
installs cleanly.

## Future option

Process execution and sandboxing sit behind a helper boundary, so they can be reimplemented
natively later without changing the core.
