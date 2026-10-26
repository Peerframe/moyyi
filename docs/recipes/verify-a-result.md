# Verify a result against its sources

A file write receipt proves that the intended bytes were saved. Reading that file back proves
which bytes are present. Neither establishes that an amount, identifier or conclusion agrees
with the original sources. Use an independently reviewed check when the task has executable
conditions, and keep those conditions separate from the model's proposed answer.

## Existing runtime entry

For an already configured trusted host and a disposable workspace:

```sh
moyyi --host /absolute/private/host.mjs -C /absolute/workspace \
  --allow-write --allow-shell --shell-toolchain node --max-requests 15
```

These are existing temporary launch grants. Writes still ask for approval and have snapshots;
commands ask separately and have a read-only workspace and no network. The host's other limits
and zero-retry configuration remain in effect. Read the [CLI](../cli.md) and
[shell restrictions](../shell.md) for grant conflicts and supported toolchains. Do not approve
changes to a source file or check script that the task says must be preserved. An unattended
trusted host should additionally deny those write targets through the existing policy interface.

State the delivery contract in the user request: which output may change, the check command,
which source and check files must remain intact, and what to do if the check cannot run. Ask for
the actual command result and final file readback. For example:

> Inspect the source files and existing report. Run `node verify-report.mjs` before editing.
> Correct only the report according to the original sources, then rerun that same check and read
> the complete corrected report. Preserve the sources and check script. Report the actual check
> result and any unresolved business decision; do not equate a repaired report with resolving
> conflicting source data.

The check must independently calculate its expected result from authoritative inputs. A script
that simply contains the model's guessed answer or checks only that a file exists is insufficient.
An exit code of zero proves only the conditions that script actually checks. Tests cannot certify
an arbitrary prose explanation or make an unknown source authoritative.

## Reproducible report-repair example

Copy the public [fixture](../../evals/tasks/verified-ledger-repair/fixture/) into a disposable
workspace. It contains two synthetic CSV sources, an incorrect existing report and the visible
`verify-report.mjs` check. The check derives the conflicting candidates from the actual sources;
it does not embed the correct amount as its answer. Its accepted input/schema is deliberately
bounded and documented in the script. This is an example task check, not a general CSV service.

The [task](../../evals/tasks/verified-ledger-repair/task.ts) keeps the 15-request/180-second ceiling.
The agent must expose the initial failure, repair the report through controlled file tools, run
the same protected check successfully, and read the final file back before answering. The
conflicting business amount remains unresolved; a correct conflict report is the requested
deliverable. No approved ledger may be produced.

There are two distinct evidence layers:

- The independent `EvalTask.check` in `task.ts` verifies report facts and unchanged source/check
  files. Its reference and negative tests validate that checker; they cannot prove the agent
  executed the command. The visible command derives facts from the current CSV sources.
- An installed live trial must separately inspect actual process receipts, ordering, the final
  file and exact results entering subsequent model requests. An untouched check returning zero
  without the required initial failure or readback is not the complete workflow.

This example does not replace the original `conflicting-ledger` task or change any earlier score.
It measures a user-requested independent verification workflow, not whether the model chooses
such a workflow autonomously.

## Actual installed result (2026-10-27)

One Flash + Responses + low trial used five requests with zero automatic retries. The initial
command exposed the wrong source-a amount (80.00 instead of 120.00), a controlled edit corrected
only the report, the same command exited zero, and the complete 288-byte result reached the final
response. Source/check bytes and modes, workspace membership and an outside canary were unchanged.
The independent task checker and execution/delivery audit passed. The final answer correctly
kept the business conflict unresolved and did not claim that a ledger had been generated.

The model initially proposed a compound command adding `echo`; the exact-command policy denied
it. Its next model request used the authorized command. This is a model correction after a denied
tool proposal, not an automatic network retry. The trial used scoped automated policy, not TTY
approval. It demonstrates this explicit task once, not autonomous verification or a general
accuracy improvement. Detailed evidence remains in the [delivery record](../tasks/2026-10-26-optimization-plan.md).

## Reuse decision

The maintained Aider source at `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` (Apache-2.0)
connects a user-selected [test command](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1616-L1623)
to [real command output](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/commands.py#L993-L1048).
That is the useful principle here. moyyi already has command isolation, result recording,
snapshot writes and readback, so this workflow adds no core port, stop hook or agent framework.
No upstream source or prompt is copied. Cline's reviewed
[TaskComplete tests](https://github.com/cline/cline/blob/c35b729049c7bb26c340df63ea9235c40b32dd29/apps/vscode/src/core/hooks/__tests__/taskcomplete.test.ts#L199-L259)
(Apache-2.0) also illustrate why completion-hook semantics must not be presumed to establish
correctness. Neither upstream test suite was executed for this workflow decision.
