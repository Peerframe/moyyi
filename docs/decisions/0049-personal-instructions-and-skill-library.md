# ADR 0049: Personal instructions and an enabled immutable Skill library

- Status: accepted for delivery three implementation, 2026-10-30.
- Scope: desktop-selected guidance, plugins and context placement; no session-format change.

## Decision

Desktop owns reviewed local Skill imports, the content-addressed library, enabled version
selection and personal-instruction storage. Runtime receives explicit trusted callbacks for
personal text and the enabled Skill catalog/body. Model-facing plugins receive no path, generic
file operation, keychain reference or ability to extend that selection. The existing CLI
`RuntimeOptions.skills` keeps its explicit directory/name selection and eager loading behavior.

Personal instructions use a dedicated context plugin. The reader returns UTF-8 text and a
SHA-256; runtime verifies the digest and the plugin enforces valid Unicode and an 8 KiB ceiling.
Its source block names `个人指令`, the digest and the whole text, without a filesystem path.
The source is collected on each request after default safety instructions and before project
`AGENTS.md`. Future requests see edits; old recorded requests remain unchanged. Guidance cannot
authorize effects or override the safety section.

The Skill library supplies at most 8 enabled names, with exactly one current digest per name.
Its catalog lists names and normalized descriptions, capped at 256 UTF-8 bytes each and 4096
bytes total. It tells the model to use `read_skill(name)` before acting on matching tasks and
never infer the instructions from a summary. An empty catalog explicitly retires earlier
availability. An unconfigured library contributes neither catalog nor tool.

`read_skill` has a read `EffectProfile`. Its prepare phase binds the selected name and digest;
it does not load full text. After the core's read policy and any approval, execution checks the
current enabled digest, invokes the bounded host reader, and rechecks the selection before
returning. Runtime verifies the returned hash and parses the original document with the existing
Agent Skills parser. Revocation, replacement or an inconsistent read returns a fixed unavailable
or unsafe-source failure and does not expose the body. The result includes name, digest and
full original `SKILL.md`. A body that does not fit the current output limit is not reported as
successfully loaded. Cancellation withholds late results.

`allowed-tools` remains metadata. Only `SKILL.md` is available through the callback; resources,
links and scripts mentioned in it are neither loaded nor executed. No new filesystem permission,
external service, credential type or replayable side effect is introduced.

## Request placement and recording

`ContextSection` gains optional `placement: "after_history"`; omission retains system placement.
The context builder places these bounded sections in a user-role suffix after recorded history
and recovery notices. Required suffixes participate in the existing context budget; only
explicitly optional sections can be omitted. The isolated evidence-answer path retains the same
placement instead of promoting catalog data into system instructions.

This is request projection, not a new transcript entry kind or storage format. The exact rendered
request records the current catalog; changes leave the stable system/history prefix untouched
and never rewrite earlier request blobs. Old catalogs are not accumulated in the transcript.
Consequently, this design does not promise preservation of the entire previous request's cache
prefix across its old catalog tail. Personal-instruction updates change the system prefix from
their section. Tool-loaded bodies remain ordinary retained tool observations.

## Reference decisions

DeepSeek Harness commit `f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (MIT) was studied:

- **Borrow** `packages/skill/skill/src/index.ts` and its README: separate discovery summaries
  from body loads, select by exact name, and recheck stale selections.
- **Borrow** `packages/skill/tool-skill/src/index.ts` and its README: summary-only catalog,
  an explicit load-before-use instruction, one source block per successful load and explicit
  empty availability.
- **Reject** its unbounded bodies and non-versioned load contract: moyyi retains the existing
  12 KiB parser limit and binds immutable digest versions.
- **Reject** `packages/skill/skill-filesystem` discovery/watch roots and resource guidance:
  this delivery imports reviewed local `SKILL.md` only, with no automatic scan or resource access.
- **Adapt the placement concept, not the event format**: DSH retains replacement catalogs as
  durable messages. moyyi uses recorded request suffixes within its existing contracts.

No upstream implementation code, Cordis dependency or DSH package is copied.

## Evidence and limits

Plugin tests cover complete source blocks, input/size bounds, metadata-only catalogs, duplicate
names, stale versions, revoked reads, cancellation and redacted callback failures. Runtime tests
cover the existing parser, cryptographic hash checks, request ordering, future-request refresh,
recorded source immutability and denial before any body read. Existing explicit CLI Skills tests
remain in place. Desktop import, file checks, backup, UI and paid acceptance evidence are owned
by the delivery record; synthetic plugin tests do not establish live-model compliance.
