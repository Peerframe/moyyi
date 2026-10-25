# Phase 3 shell: backend decision handoff

## Current authorization and outcome

The owner authorized reviewing/merging PR #12, then phase 3 as a new branch and PR, without
merging the new PR, paid calls or phase 4. After being asked about Docker plus a copied workspace,
the owner replied: **first examine how established projects solve this**. This is a request for
research, not approval of Docker or a weaker security boundary.

PR #12 fixed head `adfa3a28e959470e337796673873e0a4d27a224d` was independently reviewed with no
reproducible blocker. Six focused files passed 122/122 tests, including 13 real SIGKILL cases;
its [head CI](https://github.com/Peerframe/moyyi/actions/runs/40170696136) passed. It was merged as
`801175fff78a067436f3105bd7ebd500120ffd28`; [main CI](https://github.com/Peerframe/moyyi/actions/runs/40171281063)
passed. There was no direct push to main.

Current directory: `/Users/yxflc/Project/moyyi`. Branch: `codex/phase-3-sandboxed-shell`, based on
that latest main. This branch contains only research and status documentation. It does not add
or enable a shell tool. D1-D5, frozen persisted v1 and existing check standards are unchanged.

## Deliverable

The [fixed-source comparison](../research/phase-3-execution-backends.md) covers Codex, Claude's
public sandbox runtime, OpenCode, OpenHands and Goose, plus local synthetic probes. It separates
filesystem/network confinement, process cancellation, and direct-versus-copied workspaces.

The recommendation is revised to **native OS sandbox by default, container as an optional
stronger backend**. The earlier Docker-copy recommendation assumed an arbitrary-descendant and
host-crash guarantee stronger than the roadmap's process-group cancellation. The native route
still must enforce D3 and must state cancellation limits precisely; it is not ordinary host shell.

D6 remains pending. The owner has not yet accepted the default backend, direct-workspace mode
or the precise lifecycle guarantee. Under section 3 of the original handoff, record the options
and recommendation in the PR and stop before the dependent implementation. Do not implement
phase 3 product code or begin phase 4 from this research-only PR.

## Evidence

- PR #12: `npx vitest run src/runtime/writes.test.ts src/store/schema.test.ts src/store/snapshots.test.ts src/plugins/fs/writes.test.ts tests/runtime-writes.test.ts tests/write-process.test.ts`
  passed 122/122; fixed-diff whitespace and frozen-scope checks passed.
- Source evidence is pinned in the comparison. Public-source review is distinguished from running
  an upstream product. Claude's full closed-source cancellation path was not verified.
- Docker temporary probes passed filesystem/network/environment denial and detached-descendant
  termination by container kill. They do not validate client/host crash cleanup.
- A native process/session probe demonstrated the boundary of group-kill. Two small custom
  Seatbelt profiles aborted before their file checks; they are not passing native conformance.
- `npm run check`: typecheck passed, Biome checked 155 files, final full run passed 1,081/1,081
  tests across 46 files. The first full run had 1 watcher timeout in the unchanged
  `src/runtime/development.test.ts` asynchronous-callback case (1,080 passed). A focused rerun
  passed 10/10, then the complete gate passed. No timeout, assertion, source or check was changed;
  the intermittent failure is recorded, not represented as a fix.
- `git diff --check` passed. Seven changed/new Markdown files had 73 valid local links.
  There is no diff under src, tests, evals, dependencies or CI. No rebuild or live-model test
  was performed for this documentation-only change. The new PR CI is reported on its page.
- Existing code tests are regression evidence, not phase 3 implementation acceptance.

## Next implementation if native default is accepted

1. Define a small process capability port behind the existing tool lifecycle; implement a `shell`
   plugin without filesystem/process imports and without replacing the self-owned core.
2. Implement the macOS adapter first against actual tools: explicit roots, protected paths that
   cannot be renamed around, required system read paths, clean environment, network denied, and
   failure closed. Linux bubblewrap remains a separate backend with real environment acceptance.
3. Bind exact command/cwd to approval and journal; no unrestricted retry or model-selected backend.
4. Bound memory, output and time; TERM then KILL the owned group; observe closure, preserve
   cancellation/unknown honestly, and never automatically replay uncertain process effects.
5. Test actual file/network denial, ordinary children, ignored TERM, inherited pipes, output flood,
   cancellation races and startup failure. Declare detached-process/host-crash limits separately.
6. Run offline conformance and record the same-model comparison protocol. Actual model performance
   measurements remain unavailable under the no-paid-call constraint.

No container-copy/import subsystem is authorized by the pending decision. If stronger container
isolation is selected instead, approve its separate workspace/import and crash-lifecycle scope
before implementing it. No source copying or new dependency was done in this turn.
