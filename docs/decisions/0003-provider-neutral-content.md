# 0003: Provider-neutral content model

Status: proposed (2026-10-24)

## Context

The content model is persisted, so it is the hardest decision to change later. A model shaped
after one wire protocol inherits its gaps. Known differences:

- Anthropic Messages: signed thinking blocks must be passed back unchanged in tool loops; every
  `tool_use` must be answered by a `tool_result` in the next user message.
- OpenAI Responses: reasoning items, optionally `encrypted_content` for stateless use.
- OpenAI-compatible Chat Completions (also typical for self-hosted Qwen via vLLM/SGLang): no
  reasoning round-trip; tool-call parsing quality depends on the server's parser.
- Prompt caching on both major APIs matches on request prefixes.

## Proposal

- Keep `ReasoningPart.opaque` tied to its `origin` and replay it only to the same provider and
  model; send `summary` or nothing elsewhere.
- Keep `ToolCallPart.rawArguments` verbatim even when it does not parse.
- Before phase 1 ends, write the mapping table to and from at least two protocols and check it
  with recorded request/response fixtures, even if only one is wired to a real model.
- `ModelClient` does no retries. If an official SDK is used as transport inside an adapter, its
  built-in retries (default 2 in the official Node SDKs) are turned off.
