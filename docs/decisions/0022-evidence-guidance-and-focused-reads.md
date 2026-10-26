# ADR 0022: Evidence guidance and focused source reads

Status: accepted for this implementation, 2026-10-26. D1–D6 are unchanged.

## Problem and evidence

The bounded real-project trial recorded in [the closeout delivery](../tasks/2026-10-26-request-budget-closeout.md)
returned an answer within eight requests, but did not pass the original knowledge task. It omitted
the final consumer and error-handling path and confused an omitted parsed field with removal from
forwarded original text. Four directory listings and a guessed nonexistent directory spent part
of the budget. Whole-file prefixes included irrelevant text and could omit relevant later code.

The existing instruction source only says to inspect evidence and report truthfully. The file
reader already returns literal-search line numbers but cannot read around them. The diagnosis
uses observed tool metadata and final-answer review; private recordings and model reasoning are
not incorporated into source, prompts or test fixtures.

## Decision and alternatives

Extend the existing default-instructions context source and read capability. No new harness,
verifier model, dependency, permission or persistent format is needed. The authority and reader
decisions in [ADR 0009](0009-workspace-files.md) and
[ADR 0017](0017-working-and-project-instructions.md) remain in force.

The original, general guidance asks the model to prioritize evidence for requested claims, follow
known symbols through transformations and consumers, check error handling and lifecycle boundaries,
and review conclusions against evidence before answering. Payload transmission, authorization and
refresh are separate questions. This does not embed the Skills question, its expected answers or
the private assessment checklist. It does not request another model round or require a verbose plan.

The existing `read` gains optional `startLine` and `maxLines`. Line selection uses the same guarded
UTF-8 reader and existing 1 MiB scan limit; a partial scan is refused instead of inventing line
positions. Existing prefix reads remain unchanged. Output byte limits, protected paths, file
identity checks, cancellation and revocation still apply. Range metadata distinguishes a complete
requested window from an incomplete file or byte-clipped window. See [file semantics](../files.md).

Only changing prose would leave the concrete navigation limitation. Only adding ranges would not
address the observed incorrect inference despite already available source. Increasing requests
would not meet the owner's constraint; an extra model verifier would consume the same budget and
introduce a second unproven reasoning loop. A structured claim store or a language-specific static
analyzer would add interfaces and maintenance before a measured need. This bounded combination
uses the existing extension points and can be revised from trial evidence.

## Evidence and limits

Unit tests check line/byte semantics and the existing access boundaries. Deterministic instruction
scenarios use real temporary files, SQLite, the public runtime and scripted model turns to prove
that source, consumer and error/lifecycle evidence reaches the recorded final request. Synthetic
scenarios are independent of the Skills question. They check available evidence and enforcement,
not whether a model reasons correctly. Existing public tasks and private acceptance criteria stay
unchanged.

One new live retest uses the same project question, the original six requirements, at most eight
actual HTTP requests and zero automatic retries. Its final answer is independently checked against
source. A completed run is not by itself a passed knowledge task. The eight-request ceiling, the
last-request tool prohibition and the public-release boundary remain unchanged. No upstream or
OpenBot source or prompt was copied or substantially adapted.

## Source-supplied diagnostic and scoped answers (2026-10-26)

The owner subsequently authorized at most eight HTTP attempts in total for diagnosis and a
candidate retest. Source material came from the same committed snapshot and the original
question/criteria were retained. No reference answer or private grading checklist was supplied.
Pre-supplying evidence is a diagnostic condition, not a pass of autonomous source discovery.

The first full-source response hit the optional recorder's 8,192-event limit before completion.
That interrupted record is retained unchanged. Coalescing recorded deltas was investigated and
rejected: it changes the replay prefix when the existing consumer's event-byte budget cuts off a
stream. Recording formats and limits remain unchanged. Subsequent diagnostics use the existing
core request/transcript audit without the optional stream recorder; they do not claim stream
replay acceptance.

A full-source diagnostic then reached the unchanged 8,192-output-token ceiling, with 7,023
reasoning tokens. A pre-reviewed focused-source diagnostic also reached that ceiling, with
3,358 reasoning tokens. Both incomplete outcomes remain incomplete. In the latter's returned
answer, the model correctly described a raw-text return and its downstream use, then contradicted
those facts by asserting the data had been discarded with no consumer. Missing retrieval is
therefore not a sufficient explanation. Neither trial proves general model incapability or
establishes the accuracy of a hypothetical completed answer.

A candidate revised source-analysis guidance to cover each question before details, retain
conditions and lifecycle scope, and avoid broader repeated summaries. The autonomous retest used
five requests, no source pack and the original question/criteria. It completed normally but still
claimed that raw data had been discarded, despite having read its return and consumer. It also
missed the final core/context path. The candidate guidance was therefore withdrawn; the prior
PR #25 product baseline is retained. This trial does not establish a general performance
regression, since the previous autonomous trial had eight requests rather than five.

Keep two original public behavior tasks using different synthetic pipelines, including both
preserved and explicitly removed fields. They avoid teaching a universal "raw data is always
preserved" answer and separate captured configuration, refresh and concurrent-read failures.
Offline reference/near-miss checks validate the fixtures and graders, not model competence. Their
real-model performance remains unmeasured. The original private knowledge rubric is unchanged.

All eight authorized HTTP attempts were used: three diagnostic requests and five autonomous
requests, with no automatic retries. The original knowledge task remains unsolved. The evidence
supports errors in interpretation/expression in addition to retrieval gaps; it does not identify
a universally correct prompt or prove model incapability. More generic prompt additions or a
retrieval framework are not justified by these results. A future matched model/harness comparison
requires its own bounded trial. The optional recorder's fragmented-output limit is also unresolved;
recording formats, core limits and persisted data were not changed.
