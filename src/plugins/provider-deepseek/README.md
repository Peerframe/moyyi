# DeepSeek provider

Registers `deepseek/deepseek-flash` through `createDeepSeekPlugin(transport)`; the trusted runtime
supplies the HTTP transport. Plugin config must be absent. No credentials, filesystem access,
retries, tool execution or environment lookup live in this plugin.

Supported profile: `deepseek-responses-text-v1-2026-10-25`. Requests use the official Responses
endpoint, full stateless text/reasoning history and client function tools. Completed assistant
history with tools must retain full visible reasoning and a known successful stop reason. Unsupported
content/options fail before HTTP. Opaque replay data is unused; valid common content is sufficient.
The local output cap is 8,192 tokens. Model alias resolution remains controlled by the service.

Framing accepts chunked UTF-8 and SSE comments/line endings, rejects duplicate JSON keys and
unfinished events, and caps the wire at 8 MiB and each event at 1 MiB. Semantic assembly checks
sequence order, identities, lifecycle, completed content consistency and usage. EOF without a
terminal is `stream_interrupted`; partial output is retained and never retried here. Failed responses
and HTTP errors expose fixed diagnostics, not raw server error bodies. Unknown usage remains null.

`fixtures.ts` builds handwritten synthetic lifecycles, not recordings from DeepSeek. The provider's
wire and common-event tests use these fixtures; live API compatibility is still unverified.
For runtime configuration, record/replay and owner smoke instructions see
[docs/deepseek.md](../../../docs/deepseek.md). Design evidence is in
[ADR 0010](../../../docs/decisions/0010-deepseek-transport-and-recording.md).
