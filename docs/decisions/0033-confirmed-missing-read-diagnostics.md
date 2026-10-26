# ADR 0033: Distinguish confirmed missing reads from changed targets

Date: 2026-10-27. Status: implemented candidate; installation and live acceptance pending.

## Whole-task evidence

An independent byte-level audit of the frozen original Skills trial separates two failures.
All nine returned tool results reached the final request unchanged, but the investigation never
read several required implementations. The reader, core collection and context rendering files
were absent; search windows also omitted the middle of a relevant function. Separately, the
answer misinterpreted already-delivered raw-text preservation and revocation evidence. No old
failed answer was supplied, and the final response was not output-truncated. Original scores
and the four-request comparison budget remain unchanged.

One concrete interaction gap is recoverable: the model twice requested a nonexistent guessed
file. Its first tool result combined unavailable access and a changed target; the recorded
reasoning treated this as a possible transient condition. The workspace navigation already
contained the real filenames. This does not prove the generic error caused every later omission,
but it shows that the file capability withheld a useful, distinguishable observation. Adding
another semantic warning to the prompt would not make that observation more accurate.

## References and boundary

[OpenCode v1.19.4 read tool](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/read.ts)
distinguishes missing files and offers path recovery. This supports giving actionable feedback;
its source and suggestions are not copied. No directory contents, guessed replacements or new
path permissions are added here. [Node's system errors](https://nodejs.org/api/errors.html#common-system-errors)
distinguish absence, invalid path components and denied access. A raw `ENOENT` alone is not an
authorization or proof of initial absence: resolution through a forbidden/dangling alias or
deletion during access can also produce it. Existing guarded resolution and precondition
checks provide local design experience; read preparation remains free of filesystem I/O.

The attempted stock OpenCode comparison also exposed a separate provider-compatibility gap;
see the [bounded offline result](../research/harness-comparison.md#opencode-responses-continuation-precheck-2026-10-27).
It is not a benchmark score and does not support changing moyyi's working provider contract.

## Decision

Only explicit text reads may classify an `ENOENT` from their first target-resolution attempt.
Validate the existing ancestors under the current workspace grant, including canonical location,
protected/excluded paths and identity. Recheck authorization, cancellation and directory/root
identity before returning a fixed, path-free missing-file diagnosis. Keep diagnostic traversal
bounded to 32 relative path segments; deeper missing paths and uncertainty retain the existing
generic error. Successful reads keep their existing limits. Do not include host error text.

Use a private `FileAccessError` classification and the existing failed `{error,truncated}` result.
No public or persisted schema, tool description, prompt, core loop, retry policy, request budget
or dependency changes. Automatic instructions/Skills, documents, list/search and errors after
successful initial resolution keep their existing behavior. Do not turn missing-file information
into approval or restore a revoked grant. Identity checks reduce races, without claiming an
atomic OS path-resolution guarantee against a hostile same-user process.

## Acceptance and remaining question

Check ordinary missing leaves/intermediate paths and valid reads; exclude protected/outside
aliases, dangling links, non-directory/access errors, workspace or ancestor replacement, later
target deletion, cancellation and revocation. A real runtime/SQLite/scripted-model scenario must
record the failed diagnosis, deliver it to the next request, discover the actual path, read it
and close in four requests. Repeat the interface check from an independently installed package.

After offline verification and installation, run the unchanged original four-request task and
public four-request report task once each, Flash + Responses + low, zero retries. Preserve failed
criteria and inspect the actual source/result coverage. A useful diagnostic can be delivered even
if autonomous interpretation still fails; neither the scripted recovery nor a single live pass
establishes general model reliability. Do not enlarge retrieval or repeat the trial until green.

No upstream source or prompt was copied or substantially adapted.

Source verification: `npm run check` passes 110 files / 2,380 tests.
`npm run eval:files` passes 17/17 scenarios, including the four-request missing/discover/read/answer
sequence and exact next-request propagation. Dedicated absence/boundary tests pass 30/30.
Installed-client assertions additionally bind each diagnostic/discovery/read result to its call ID;
external package, CI and the fresh live trial remain separate delivery gates.
