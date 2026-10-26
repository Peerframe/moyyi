# DeepSeek and model recordings

Batch 6 adds a programmatic DeepSeek provider and deterministic record/replay. The subsequent
batch 7 [CLI](cli.md) connects it through explicit trusted host configuration. The default runtime still makes no network request without explicit configuration.
Automated checks use synthetic protocol responses. Earlier live probes exposed reasoning-metadata,
final-answer-phase and tool-commentary incompatibilities, retained in the historical
[compatibility follow-up](tasks/2026-10-25-deepseek-compatibility.md). The subsequent #19 installation
passed a bounded live file-read/tool-continuation task and offline replay. Broader project-answer
quality has not passed its original criteria. See the [system overview](system-overview.md) for
the distinct merged, installed-candidate and task-acceptance states.

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

The supported request profile is intentionally narrow. Images, opaque-only/summarized reasoning,
refusal content items, unknown assistant phases, hosted tools and stored server
conversations are rejected. Assistant output accepts only absent/null/`"final_answer"`/`"commentary"`
phase, then discards the annotation while retaining the text and order. Added metadata
is provisional; contradictory explicit phases at item done and response terminal fail. Missing/null
annotations do not contradict an explicit value. Phase never overrides the response terminal,
promotes an interrupted or failed response to success, or changes a tool turn into a final answer. Common recordings and
the next plaintext request do not carry `phase`.
An auxiliary `encrypted_content` string in reasoning output is accepted only alongside visible
reasoning, bounded to 64 KiB UTF-8, and discarded. It is not a replacement for plaintext or a replay
credential. An item that carries it must finish with nonblank visible reasoning, even when the
field disappears at completion. The documented stateless input sends only full visible reasoning;
the auxiliary field never reaches normalized recordings, context or a later request.
The adapter also refuses incomplete or unproven assistant history when tools or historical calls
are present. It retains all actual visible reasoning, without requiring or fabricating reasoning
on every complete turn. A cancelled or truncated conversation may therefore require a new session;
automatic context rebuilding is not
implemented. No partial reasoning is silently presented as a complete continuation.

## Opt-in recording and offline replay

Installed hosts import `FileRecordingSink`, `loadModelRecordings` and `DEEPSEEK_API_PROFILE`
from `moyyi/runtime`. Add to a connected runtime:

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

## Owner-only live smoke (acceptance incomplete)

This procedure requires explicit owner authorization and a bounded paid-call budget. One later
owner run stopped at commentary parsing before any tool execution; it did not complete acceptance.
No live command is run by the automated tests, demo or this compatibility implementation.

1. Use a disposable workspace outside protected paths (including `.moyyi`), containing only
   `note.txt` with synthetic text. Preflight an actual tool read with a synthetic transport first.
   Create separate fresh
   private store/recording directories outside it. Supply a credential callback from your trusted
   host; never paste the key into a task, source file, fixture or PR.
2. Configure the runtime as above, with live recording and limits `maxModelRequests: 3`,
   `timeoutMs: 120000`, `maxRetries: 0`, `maxModelResponseBytes: 65536` and
   `maxToolOutputBytes: 8192`. The adapter uses its local 8,192-token output cap. Send `session.create`,
   then `run.start` asking it to read `note.txt` and quote its contents. Use the event subscription,
   `idle()` and `close()` lifecycle demonstrated in `scripts/demo-deepseek-replay.ts`.
3. Verify the remote service accepted the request, all actual visible reasoning and function arguments
   decode, the actual read succeeds, and the next request contains the full reasoning, call and
   result. Confirm the final response and capture unknown versus reported token usage truthfully.
4. Replay locally with the captured records and identical workspace; verify no network call and
   identical final answer/tool results. Separately exercise owner-triggered cancellation, without
   pretending offline cancellation timing exactly repeats a live run.
5. Record date, requested alias `deepseek-flash`, API profile, reported model string, any independently
   known server revision, and actual usage/charge. A reported alias alone means the underlying model
   revision remains **unknown**. Keep raw private records local and report only sanitized evidence.

### Historical compatibility snapshot, before the successful #19 smoke

The following failures are retained as historical evidence. They do not describe the current
installation or authorize another request; current outcomes are in the [system overview](system-overview.md).

At that checkpoint the tool smoke had not completed. Three separately authorized single-request
probes received HTTP 200, without retries. The second captured a partial stream exposing auxiliary
reasoning metadata; its prefix still correctly reports interruption. The third captured all 23 events,
including a final `OK`, but the installed decoder rejected `phase: "final_answer"`. Offline replay
through the corrected source produces `completed` / `end_turn`, final input 34 and output 11 tokens
(including 9 reasoning tokens). No response content or terminal was fabricated. The private wire
is not committed; repository regressions use synthetic data.

A subsequent owner-authorized read task made one HTTP request with zero retries (four total historical
requests). It received 200 but stopped at a message that began as `final_answer` and completed as
`commentary`, followed by a function-call start. No file tool ran. Its private capture has no terminal,
so usage and billing remain unknown. The source correction is verified offline; no paid request is
made by this fix and an unmerged branch does not replace the installed candidate. The diagnostic
workspace was also mistakenly inside protected `.moyyi`; separate offline checks confirmed denial
there and successful reads in an external temporary workspace. No permission rule was relaxed.

Actual billing, underlying model revision, phase-sensitive continuation, real-agent pass@1/pass^k,
tool continuation, normal task latency and model quality were unverified at that checkpoint.
The subsequent #19 tool-continuation run is summarized at the top of this document; it does not
retroactively change these incomplete records. An old normalized error recording still replays
its original error. No further paid request is authorized by this documentation.
The CLI, controlled writes, native commands, compaction and second provider are merged.
The local installable candidate is described in [installation.md](installation.md); no official
release or live acceptance is implied.
