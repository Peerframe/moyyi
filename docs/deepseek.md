# DeepSeek and model recordings

Batch 6 adds a programmatic DeepSeek provider and deterministic record/replay. It does not add an
interactive CLI. The default runtime still makes no network request without explicit configuration.
All development evidence uses synthetic protocol responses; live API acceptance remains pending.

## Offline entry points

```sh
npm run demo:deepseek-replay
npm run eval:deepseek
```

The demo uses handwritten DeepSeek SSE, the real provider, real authorized workspace files and
SQLite. It records normalized requests/events, then runs again with the replay client and checks
results. Its temporary workspaces, stores and recordings are removed. No credential is required.
The eval is independent of the original public task checkers and does not measure model quality.

## Programmatic connection

The trusted application configures `createRuntime` with:

```ts
{
  model: { provider: "deepseek", model: "deepseek-flash" },
  dataDirectory: "/absolute/private/new-data-directory",
  deepseek: { getApiKey: async () => /* obtain from the owner's credential store */ key },
}
```

`getApiKey` is called only when a request is sent. It is not a tool, plugin config or prompt field.
The host sends one POST to `https://api.deepseek.com/responses`, prohibits redirects, and discards
secret-bearing network diagnostics. The provider handles text, full visible reasoning and local
function calls; the runtime's existing policy controls file tools. It does not grant tool network,
write or shell access. Only the core can retry a qualifying model error.

The supported request profile is intentionally narrow. Images, encrypted/summarized reasoning,
refusal content items, assistant phases, hosted tools and stored server conversations are rejected.
The adapter also refuses incomplete or unproven prior reasoning when tools are present. A cancelled
or truncated conversation may therefore require a new session; automatic context rebuilding is not
implemented. No partial reasoning is silently presented as a complete continuation.

## Opt-in recording and offline replay

Import `FileRecordingSink` and `loadModelRecordings` from `src/runtime/model-recording.ts`, and
`DEEPSEEK_API_PROFILE` from `src/plugins/provider-deepseek/index.ts`. Add to a connected runtime:

```ts
modelRecording: {
  sink: new FileRecordingSink("/absolute/private/new-recordings"),
  apiProfile: DEEPSEEK_API_PROFILE,
  source: "live", // use "synthetic" for injected fixtures
}
```

Use a fresh directory. Records include private prompts, complete reasoning and tool results; keep
it outside repositories and do not publish it. File permissions are 0700/0600, not encryption.
The built-in file sink is automatically excluded from workspace file tools. Protect a custom sink's
paths through `protectedPaths`. Custom sinks implement `write(recording, writeId)` and
`invalidate(writeId)`; a rejected write must leave no replayable successful artifact from that attempt.
The built-in file sink uses a pending marker and rejects recovery of an incomplete publication. No HTTP authorization headers are captured. Explicit live/synthetic
labeling is the trusted caller's responsibility, not evidence inferred from response text.

For replay use a new runtime/data directory, the same workspace state and model, and:

```ts
modelReplay: {
  records: loadModelRecordings("/absolute/private/new-recordings"),
  apiProfile: DEEPSEEK_API_PROFILE,
}
```

Do not supply `deepseek` or `modelRecording` during replay; configuration rejects the combination.
A changed request, model, profile or invalid record fails without network fallback. Sequential
recordings are bounded at 8 MiB/8,192 events per exchange and 64 MiB/1,024 files per directory.
Concurrent model requests in one recording/replay wrapper fail explicitly; use separate runtimes
and directories for independent captures. `runtime.idle()` and `runtime.close()` wait for
recording finalization, including consumer cancellation; custom sinks must settle their operations. The lower-level `ReplayModelClient.assertConsumed()`
checks that a whole sequence was used.

These files replay normalized model events, not raw HTTP timing or tool side effects. Tool execution
still goes through the ordinary policy and journal. Changed files, policy or cancellation timing can
change the outcome; this is not an instruction to retry an unknown effect after a crash. Integrity
hashes are not signatures and do not make a hostile recording trusted.

## Owner-only live smoke (not executed)

This procedure is a future paid check requiring the owner's explicit credential access. No live
command is run by the batch 6 tests, demo or implementation process.

1. Use a disposable workspace containing only `note.txt` with synthetic text. Create separate fresh
   private store/recording directories outside it. Supply a credential callback from your trusted
   host; never paste the key into a task, source file, fixture or PR.
2. Configure the runtime as above, with live recording and limits `maxModelRequests: 3`,
   `timeoutMs: 120000`, `maxRetries: 0`, `maxModelResponseBytes: 65536` and
   `maxToolOutputBytes: 8192`. The adapter uses its local 8,192-token output cap. Send `session.create`,
   then `run.start` asking it to read `note.txt` and quote its contents. Use the event subscription,
   `idle()` and `close()` lifecycle demonstrated in `scripts/demo-deepseek-replay.ts`.
3. Verify the remote service accepted the request, full visible reasoning and function arguments
   decode, the actual read succeeds, and the next request contains the full reasoning, call and
   result. Confirm the final response and capture unknown versus reported token usage truthfully.
4. Replay locally with the captured records and identical workspace; verify no network call and
   identical final answer/tool results. Separately exercise owner-triggered cancellation, without
   pretending offline cancellation timing exactly repeats a live run.
5. Record date, requested alias `deepseek-flash`, API profile, reported model string, any independently
   known server revision, and actual usage/charge. A reported alias alone means the underlying model
   revision remains **unknown**. Keep raw private records local and report only sanitized evidence.

Service acceptance, real-agent pass@1/pass^k, cost, latency and model quality remain unverified.
The interactive CLI and hot reload belong to batch 7, which has not started.
