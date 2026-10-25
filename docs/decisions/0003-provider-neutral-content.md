# 0003: Provider-neutral content model

Status: accepted (2026-10-25): option B, with the constraints below

## Context

The content model is persisted, so it is the hardest decision to change later. A model shaped
after one wire protocol inherits its gaps. Known differences:

- Anthropic Messages: signed thinking blocks must be passed back unchanged in tool loops; every
  `tool_use` must be answered by a `tool_result` in the next user message.
- OpenAI Responses: reasoning items, optionally `encrypted_content` for stateless use.
- OpenAI-compatible Chat Completions (also typical for self-hosted Qwen via vLLM/SGLang):
  reasoning fields and replay requirements depend on the provider and server profile; the
  shared wire format does not guarantee portable reasoning replay. Tool-call parsing quality
  depends on the server's parser.
- Prompt caching on both major APIs matches on request prefixes.

The batch 2 mapping research
([content-model-mapping.md at `d96f9f8`](https://github.com/Peerframe/moyyi/blob/d96f9f86f149d7e2c6d9170ea3d760935578b295/docs/research/content-model-mapping.md))
showed that the v1 parts cover the common text and function-call path but lose replay metadata,
refusals, termination detail and unknown usage (gaps G1–G10). It compared three options:

- **A.** Keep v1 and enforce a narrow supported subset.
- **B.** A typed common model plus provider-scoped replay information.
- **C.** Provider-native messages as the main persisted model.

## Decision

**B.** moyyi owns a typed common content model. Each provider adapter may attach a replay
envelope that carries only what that provider needs to continue a conversation exactly
(signed or encrypted reasoning, item and message IDs, `phase`, and similar).

C is rejected because the core, context builder, policy, evals and training export would each
need to understand every vendor's shapes. A is rejected because its only advantage, avoiding a
format migration, is worth nothing today: no store exists and nothing has been written to disk.

### Constraints on the replay envelope

The main risk of B is two representations of the same content drifting apart: after an edit,
a compaction or a branch, the common parts change but an old envelope would still be replayed,
so the model would see something other than what the transcript records. These rules prevent
that:

1. **Bound to content.** An envelope records the hash of the canonical serialization of the
   common parts it accompanies (JSON Canonicalization Scheme, RFC 8785, then sha256). It is
   replayed only if that hash still matches.
2. **Bound to origin.** It also records the origin profile: provider, model, and the API version
   or server profile it was produced under. It is replayed only to an exactly matching profile.
3. **Invalidated, never repaired.** Editing, compacting, truncating or rewriting the covered
   content invalidates the envelope. The adapter may render from the common parts alone only
   if they still form a valid request under its supported provider profile. Otherwise it must
   reject explicitly or use a separately specified and verified context rebuild. Required
   provider state must not be silently dropped, and tool actions must not be automatically
   repeated. An envelope is never patched to fit new content.
4. **Opaque outside its adapter.** Only the adapter that produced an envelope reads it. The core,
   context builder, policy and evals treat it as opaque bytes and never base a decision on it.
   It grants no authority and cannot change execution flow.
5. **Bounded and versioned.** Each envelope has a provider-specific version and a size cap.
   Oversized envelopes are rejected, not truncated.

### What the common model must carry

Anything the core decides on belongs in the common model, not in an envelope:

- refusal content, separate from ordinary text (G5)
- the terminal outcome: a normalized outcome plus the provider's own termination detail (G6)
- usage with defined units and presence. Input total includes cache reads and writes; output
  total includes reasoning tokens the provider already counts; a missing counter is unknown,
  never zero; partial and final usage are distinguished (G7)
- tool-call provenance: the raw argument string, whether it was synthesized from an object, and
  the provider's call ID kept separate from any item ID (G1, G2)
- the kind of reasoning content: visible text, summary, or provider-opaque state (G4)

Not persisted, but changed in the model contract for retry safety: an error records whether any
output was already visible to the user, not only whether a part completed (G9).

### Scope of the first release

One provider is implemented first (decision D5). Features that provider or the common model does
not support are rejected explicitly by the adapter, as option A would do, instead of being
silently dropped.

### Persisted format

Because no store exists and no data has been written, persisted format version 1 may be amended
in place for this change, instead of adding version 2 and a migration. This is a one-time
exception to [change-persisted-format.md](../recipes/change-persisted-format.md), and it ends
when any store first writes data (batch 3). The amendment updates `fixtures/v1.ts` in the same
change. From then on the recipe applies without exception.

## Carried over

- Keep `ToolCallPart.rawArguments` verbatim even when it does not parse.
- `ModelClient` does no retries. If an official SDK is used as transport inside an adapter, its
  built-in retries (default 2 in the official Node SDKs) are turned off.

## Left to the implementation brief

These are design details within the decision, not owner decisions: exact type and field names,
the envelope size cap, where envelopes are stored (inline or as blobs), and the error-kind
mapping (`ModelErrorKind`) that the research did not cover.

## Pre-storage v1 amendment (2026-10-25)

The owner authorized the amendment and then batch 3 in the
[implementation brief](../tasks/2026-10-25-v1-and-storage.md). The existing store is still absent;
the checkout has no local `.moyyi` data. The amended typed fixture is the v1 baseline used by
batch 3, and the one-time amendment is consumed by this change. Later incompatible changes
require a version bump and migration; neither this record nor batch 3 authorizes batch 4.

- `RefusalPart` is distinct from text. Reasoning distinguishes full visible text, summary text
  and an opaque marker; the marker carries no provider object. DeepSeek needs full visible
  reasoning, not a summary, for its supported stateless history.
- `argumentsSource` distinguishes verbatim arguments from object serialization; `providerItemId`
  is separate from `providerCallId`. Invalid verbatim JSON is still preserved exactly.
- `providerStopReason` retains provider termination detail next to normalized `stopReason`.
  `other` does not imply successful completion. Usage has unknown/partial/final status and
  explicit nullable counters, including the reasoning subcount; missing is not zero.
- Replay is a message-level envelope. Its hash covers `{role, content}` including array order.
  Its origin adds a non-secret `apiProfile` and `modelRevision`; null revision may be recorded
  but never proves replay compatibility. Provider-only payload is a string, never decoded by
  generic contract helpers. The entire canonical UTF-8 envelope is limited to 1 MiB.
- Pure replay helpers canonicalize JSON, validate envelope structure, compare bindings and
  remove envelopes explicitly on edits. SHA-256 is an injected trusted function so contracts
  remain free of packages and I/O. Passing validation is not an authority grant or a claim that
  a provider accepts the request. Fallback validity remains the adapter's responsibility.
- Stream errors retain usage and whether any delta or completed part escaped. This is
  conservative retry evidence, not an implemented retry policy or loop.

Targeted evidence reviewed on 2026-10-25: [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785),
[DeepSeek Responses](https://api-docs.deepseek.com/guides/responses_api/) and
[thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/). Responses accepts complete
plain-text reasoning items but not reasoning summaries/encrypted content; unsupported input
must be rejected by the future adapter, not silently normalized away.

Canonicalization options reviewed: `canonicalize@5.1.0` (2026-09-18, Apache-2.0,
[source 31fb117](https://github.com/erdtman/canonicalize/tree/31fb117afde3ef305b2e1d99bde539bf6300bc62))
and a strict, small RFC 8785 serializer using ECMAScript primitives. The package permits
`toJSON` and omission of some non-JSON values, so it would still need input validation; placing
it in runtime would also prevent plugins from using it through the existing contract boundary.
Choose the pure serializer plus injected hash, with standards vectors and rejection tests.
No upstream implementation was copied and no dependency or boundary exception was added.
