# Chat Completions and vLLM examples

Handwritten on **2026-10-25** from the official sources listed in `examples.json`. These are
synthetic protocol examples, not recordings, copied documentation snippets, successful API
calls, or a selected shasha base model. No credentials are present. The PNG is a generated
one-pixel fixture. `fixture-*` models and IDs are symbolic. Qwen3-8B is an illustrative model
identifier from Qwen's deployment guide, not a deployment or training recommendation.

`requests[].body` is a request body; `responses[].body` is a response body. The surrounding
envelope is test metadata, not part of the API. Stream `event: message` means the default SSE
event; `[DONE]` is the literal SSE data sentinel, not JSON. The interruption sample intentionally
has neither a finish reason nor `[DONE]`.

| ID | Purpose |
| --- | --- |
| image-input | User text and an image URL/data URI, including image detail metadata |
| tool-roundtrip | Separate assistant call and tool result; typed unknown-effect status must be rendered explicitly as text |
| qwen-reasoning-request | vLLM's model/template-specific thinking option |
| tool-call / tool-success-with-usage | Raw argument whitespace, call ID, finish chunk, then usage-only chunk before `[DONE]` |
| refusal | A refusal message can accompany `finish_reason: stop` |
| truncated-arguments | Incomplete JSON plus length termination; never execute it |
| vllm-visible-reasoning | Extension field `reasoning`, distinct from ordinary text |
| transport-interruption | Partial transport output cannot be turned into successful completion |

As retrieved, vLLM's stable docs use `reasoning`; `reasoning_content` is the old name. A future
adapter must pin a server/version/parser profile and explicitly select an alias if supporting an
older server. Reasoning text is not a signed, portable reasoning continuation. Tool-call parsing
depends on the checkpoint template and server parser, and still requires core validation.

The common usage fixture uses current OpenAI `prompt_tokens_details.cache_write_tokens` and
`cached_tokens`. Its presence is not a claim that every vLLM deployment returns those optional
fields. Cache and reasoning statistics are subcounts, not extra tokens to add to totals. The
unknown tool-result text is a proposed moyyi rendering, not a standardized wire status field.
See the [mapping research](../../../../docs/research/content-model-mapping.md) for all gaps.
