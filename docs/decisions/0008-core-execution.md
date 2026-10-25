# 0008: Self-owned execution core and bounded host adapters

Status: accepted for batch 4 (2026-10-25)

## Context

The owner authorized batch 4 after merging the amended v1 contracts and batch 3 storage. The
agent loop, tool lifecycle, permission checks, cancellation and recovery must remain moyyi's
own guarantees. A provider SDK or another agent framework must not own that state machine.
Batch 4 needs an executable, deterministic loop before adding real filesystem capabilities,
processes or a paid provider. [ADR 0006](0006-security-boundaries.md) remains authoritative.

## Decision

The pure core receives ports for persistence, context assembly, permission policy, argument
validation, precondition verification, hashing, time and scheduling. The runtime wires these
ports and the existing atomic plugin registry. A provider handles one model request; a tool
implements preparation, execution and optional reconciliation. Neither owns retries, approval
or journal transitions. No agent framework is introduced.

The executor validates model arguments before preparation, checks permissions before both
preparation and execution, binds approval to the prepared action and permission revision,
rechecks preconditions, and commits the start barrier before execution. A revocation followed
by a new grant changes the revision; an earlier approval cannot silently become valid again.
The runtime's selected workspace is the authority boundary. A tool-supplied precondition root
can narrow this boundary, never widen it. Unknown effects remain visible and are not executed
again merely because recovery cannot prove their outcome.

### Context and policy

`MinimalContextBuilder` preserves the full root-to-head transcript. User messages, assistant
parts, tool results, notices and recorded summaries are all rendered. A summary does not
silently delete earlier history. Assistant replay envelopes are forwarded unchanged for their
originating adapter to validate; the builder does not interpret their payloads. Every unsettled
effect is appended as an explicit recovery notice including its evidence.

System sections are ordered `static`, `session`, `turn`, preserving registration order within
each group. Capacity uses the UTF-8 byte length of the whole common request, 256 tokens of
framing reserve per request/message/tool, and the requested output allowance. This deliberately
overestimates byte-tokenized text and stops explicitly on overflow. It is not a provider-tokenizer
measurement or a guarantee for arbitrary provider wire transformations. Images are rejected
until an adapter-specific image budget exists; the small blob reference must not disguise their
cost. Automatic compaction, context eviction and provider-specific cache annotations are deferred.

`ReadOnlyPolicy` enables reads by default, allows runtime-controlled grant/revocation, and can
require approval for selected read tools. Each grant or revocation increments its revision.
Approval is requested after read-only preparation supplies a digest; preparation itself remains
subject to the read grant and any restrictive plugin rules.
Workspace writes, processes and external effects remain denied even after `grant()`. Argument
text, a tool's name and an approval request cannot expand that scope. This is a base effect-class
policy; resource confinement is an independent runtime responsibility.

### Argument validation dependency

Use the exact MIT-licensed release `ajv@8.20.0` (released 2026-04-24). It implements JSON Schema
Draft 7 behind `ArgumentValidator`; the core imports no package. Configure strict validation,
`allErrors: false`, own-property checks, and no coercion, defaults, property removal, asynchronous
schemas or `$data`. No remote resolver is installed and nonlocal `$ref` values are rejected.
Schemas are bounded to 64 KiB, model input to the configured byte limit, and structural nesting
to 128. Unknown schema keywords fail rather than being ignored.

Raw arguments must be valid, unambiguous JSON: duplicate decoded keys, non-finite numbers and
invalid Unicode are rejected. Schema snapshots reject cycles, accessors and non-JSON values
without invoking getters. The bounded 64-entry cache uses canonical schema contents, not object
identity; each compiled schema has an independent registry. Mutating a registered schema or
reusing its `$id` cannot reuse another validator. Literal `__proto__`, `constructor` and
`prototype` JSON keys remain data if a schema permits them. They are never merged into runtime
configuration or interpreted as permission grants by this adapter.

Installed plugin schemas are trusted code, not model-generated schemas. Size/depth limits and
first-error validation do not make arbitrary regular expressions or recursive schemas safe;
plugin review must assess their cost. An in-process timer cannot interrupt synchronous schema
evaluation. The adapter does not claim a CPU sandbox for hostile plugins.

Compared with `@hyperjump/json-schema@1.18.0` (2026-10-05, MIT), Ajv directly fits the synchronous
port and local compilation requirement. Hyperjump supports Draft 7 and other dialects, but its
document registration and asynchronous compilation/retrieval surface require more integration
for this narrow boundary. Its filesystem/HTTP loading and extensible dialects are not needed
here. Both are viable maintained standards implementations; a handwritten schema validator
would add correctness and maintenance work without advancing the self-owned agent loop. The
dependency remains replaceable through this port. No upstream source was copied or adapted.

### Host preconditions and current limits

`WorkspacePreconditions` checks existing file hashes and resolved path containment. It resolves
the nearest existing ancestor for missing targets, so a missing leaf under an escaping symlink
does not pass. A null hash means an absent target inside the workspace, not an unreadable file.
An existing target must be a regular file, no larger than 64 MiB; hashing uses a nonfollowing
file descriptor and checks whether file metadata changed during the read. Cancellation denies
the check. Tool-selected roots must be existing subdirectories within the runtime workspace.

Both lexical and resolved paths reject known credential locations: `.ssh`, `.aws`, `.azure`,
`.gnupg`, `.kube`, `.npmrc`, `.netrc`, `.pypirc`, `credentials`, `credentials.json`, standard
`id_rsa`/`id_dsa`/`id_ecdsa`/`id_ed25519` names, `.env`/`.env.*`, and `.key`/`.pem` suffixes.
Checks are case-insensitive and apply to path components, including the workspace itself.
This conservative first boundary can reject nonsecret examples or public certificates; it is
not a universal secret detector. Credential placement and narrower explicit grants require the
filesystem phase's capability design, not exceptions supplied by model arguments.

This verifier is a preflight check, not an atomic filesystem operation or an OS sandbox. It
does not eliminate concurrent same-user filesystem replacement between check and a future
effect. Batch 4 adds no file tools, no filesystem handles to `ToolContext`, no writes, no shell,
and no arbitrary tool network access. Future confined capabilities must enforce the boundary
at the actual operation and preserve the executor's immediate precondition recheck.

## Evidence and verification

Primary sources reviewed on 2026-10-25:

- [Ajv 8.20.0 release](https://github.com/ajv-validator/ajv/releases/tag/v8.20.0),
  [options](https://ajv.js.org/options.html), and
  [strict mode](https://ajv.js.org/strict-mode.html): synchronous compilation and configurable
  strict, nonmutating validation.
- [Ajv security considerations](https://ajv.js.org/security.html): trusted-schema assumptions,
  cyclic/deep input and regular-expression risks; first-error validation is retained.
- [Hyperjump 1.18.0 release](https://github.com/hyperjump-io/json-schema/releases/tag/v1.18.0),
  [versioned README](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/README.md), and
  [package metadata](https://github.com/hyperjump-io/json-schema/blob/v1.18.0/package.json):
  Draft 7 support, asynchronous registration/compilation model and MIT licensing.

Focused tests cover complete context mapping/replay preservation, ordering and capacity failures;
read grant revisions and denial of other effect classes; malformed/duplicate JSON, schema
mutation, nonmutating validation and unsupported references; and actual disposable workspace
files with overwrite, symlink, missing-target and protected-path cases. End-to-end deterministic
loop/executor evals remain part of the batch 4 integration gate. No paid model calls or claims of
real provider, shell containment or filesystem tool support are included.
