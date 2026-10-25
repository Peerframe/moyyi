# Anthropic provider

The phase 5 branch adds an opt-in Messages adapter for `anthropic/claude-sonnet-5-5`. DeepSeek
remains available independently. Offline acceptance covers the real adapter, runtime and store;
the remote Anthropic service and real model quality have not been tested during this delivery.

## Connect a trusted host

Use the existing CLI `--host` entry with a private module outside the workspace:

```js
import { getAnthropicKey } from "/absolute/path/to/your/credential-provider.mjs";

export default {
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  dataDirectory: "/absolute/private/moyyi-anthropic-data",
  anthropic: {
    getApiKey: getAnthropicKey,
    accountScope: "personal-anthropic-account",
  },
};
```

The credential provider must already exist; this is not a built-in keychain adapter. The callback
is invoked for a request, not during startup. No environment/config/key discovery occurs.
`accountScope` is a stable, non-secret label for the actual provider account. Keep it stable when
rotating a key for that account; change it when switching accounts. Do not use the key as a label.
Mislabeling different accounts can make the service reject otherwise locally valid replay.

```sh
npm run moyyi -- --host /absolute/private/moyyi-host.mjs -C /absolute/workspace
```

Running a live host incurs the provider's normal fees. No live host is run by the offline tests.
Host modules execute trusted local code. Keep credentials out of source, arguments, recordings
and PRs. Provider request/response data can contain private content even when keys are excluded.

## Supported behavior and limits

The transport uses only `https://api.anthropic.com/v1/messages`, API `2023-06-01`, with no
redirect following or implicit retries. The profile supports streamed text, adaptive thinking,
redacted thinking, local function calls/results, refusals and usage. Images, hosted server tools,
provider compaction and fallback models are unavailable. Unknown protocol variants fail closed.
The context window is 1M tokens; the adapter caps requested output at 8,192 tokens and also
enforces byte/event limits. These are ceilings, not a promised task size or latency.

Only complete, accepted responses may authorize tool execution. An interrupted tool block stays
recorded but cannot run. Missing usage is unknown, never zero; input totals include uncached,
cache-read and cache-write components only when the required counters are present.

`/compact` uses the existing one-request summary flow. Thinking replay is bound to content,
model/API, account and prior rendered context. Changed context strips invalid old thinking using
the documented fallback, without fabricating signatures or repairing opaque blocks. Complete
text/tool history survives; a reasoning-only turn without legal replay can require a new session.
Fresh reasoning after compaction can replay on subsequent turns, including after restart.
Turns without valid replay, and consecutive user turns (including steering/notices), conservatively
invalidate earlier thinking. This covers failure paths without an envelope and survives restart;
the tradeoff is less reused reasoning even for some otherwise valid histories. Text and complete
tool pairs remain available.
History containing interrupted tool calls is conservatively rejected on continuation, even if a
local failed result exists; start a new session. The adapter does not fabricate a completed
provider turn or run its partial tool call to make such history acceptable.

Generic `RuntimeOptions.modelRecording` / `modelReplay` work with `ANTHROPIC_API_PROFILE`
exported from the plugin. Replay cannot be configured with a live connection or fall back to one.
Synthetic recording/replay is exercised by:

```sh
npm run eval:anthropic
```

Five scenarios cover tools/record-replay, compaction/restart, interrupted tool refusal, unknown
usage and refusal followed by restored context/restart without reviving old thinking.
Synthetic signatures are not service signatures. Live smoke (text → file tool → text,
cancel, restart and compaction) still needs separate authorization, credentials and a budget.
See [ADR 0015](decisions/0015-anthropic-and-web.md) and
[protocol evidence](research/phase-5-anthropic-protocol.md).
