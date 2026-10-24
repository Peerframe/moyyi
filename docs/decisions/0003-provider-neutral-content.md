# 0003: Provider-neutral content model

Status: accepted (2026-10-25): option B, with the constraints below

## Context

The content model is persisted, so it is the hardest decision to change later. A model shaped
after one wire protocol inherits its gaps. Known differences:

- Anthropic Messages: signed thinking blocks must be passed back unchanged in tool loops; every
  `tool_use` must be answered by a `tool_result` in the next user message.
- OpenAI Responses: reasoning items, optionally `encrypted_content` for stateless use.
- OpenAI-compatible Chat Completions (also typical for self-hosted Qwen via vLLM/SGLang): no
  reasoning round-trip; tool-call parsing quality depends on the server's parser.
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
   content invalidates the envelope. The adapter then renders from the common parts alone. An
   envelope is never patched to fit new content.
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
