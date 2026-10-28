# Kimi Open Platform

moyyi can explicitly connect `kimi/kimi-k3.1-pro` through Chat Completions. This opt-in connection
does not change the selected model or enable writes, shell or web tools. It is distinct from Kimi
Code subscriptions and third-party gateways. See [ADR 0036](decisions/0036-kimi-chat-provider.md).

## Explicit host setup

Create a private host module outside the project. The credential callback below is a placeholder
for the owner's existing secure credential store; moyyi does not automatically find keys.

```js
import { getKimiKey } from "/absolute/private/credential-provider.mjs";

export default {
  model: { provider: "kimi", model: "kimi-k3.1-pro" },
  dataDirectory: "/absolute/private/moyyi-kimi-data",
  kimi: { region: "cn", getApiKey: getKimiKey },
  kimiReasoningEffort: "low",
  limits: { maxModelRequests: 8, maxRetries: 0 },
};
```

Use `region: "cn"` for keys from `platform.kimi.com`, or `"global"` for `platform.kimi.ai`.
The APIs use different credentials. The host refuses other region values and never tries a
different endpoint with the key. Do not put keys in prompts, tool arguments, shell history or
source files. Read-only startup and session loading do not access the credential callback.

Start the installed CLI with `moyyi --host /absolute/private/kimi-host.mjs -C /workspace`.
Sending a message or requesting model compaction can incur API charges. The example selects
eight requests per task; the current default host is not changed by this documentation.

## Supported protocol and limits

This connection uses text, visible reasoning and local function tools on
`/v1/chat/completions`, with explicit low/high/max effort (default low), an 8,192-token output
cap and the model's 1,048,576-token context profile. The runtime's byte/request/time caps still
apply. Thinking cannot be disabled; `none` is not an effort setting. Temperature and top-p are
not overridden. Existing working instructions and permissions remain responsible for tool use.

Preserved reasoning and complete tool results are returned on later requests. A response is
complete only after the supported finish reason and stream terminator; partial calls never
execute. Truncation does not count as task success. Missing usage is unknown; cache reads/writes
are subsets of input and reasoning is a subset of output, not additional totals.

The last allowed request retains history/tool definitions and disables new tool calls. The
Responses endpoint currently rejects that mode, so this provider deliberately uses Chat.
It does not implement SDK retries, automatic protocol fallback, remote tool execution, images,
audio, Kimi Code credentials or custom gateways. Errors hide raw credential-bearing exceptions.
HTTP429 diagnostics read at most16 KiB/128 chunks for at most2 seconds. The exact documented
`error.type` distinguishes engine overload, account rate limits and account quota/balance;
unknown, malformed or unavailable diagnostics keep an explicitly unknown429. Messages are fixed
locally; raw response messages are never exposed. This does not add retries or resolve upstream
capacity. See [ADR0036](decisions/0036-kimi-chat-provider.md#http429-diagnosis-follow-up-2026-10-28).

## Offline acceptance and diagnostics

`npm run eval:kimi` exercises synthetic wire data through real runtime/files/SQLite, including
tool continuation, last-request authority, recording/replay and compaction/restart. `npm run
verify:package` also checks the installed adapter from outside the source checkout without keys
or real HTTP. These checks do not certify factual answers.

Use `kimiApiProfile(effort)` from `moyyi/runtime` when explicitly configuring model recordings or
replay. The configured effort and recording profile must match. Replay does not accept a live
connection or fall back to the network. Treat transcripts/recordings as private content.

Live quality evidence and any remaining failed criteria are recorded separately in the
[system overview](system-overview.md), including the exact task and baseline version used.
