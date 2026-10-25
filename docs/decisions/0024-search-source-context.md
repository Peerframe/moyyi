# ADR 0024: Source context in bounded search results

Status: accepted for this implementation, 2026-10-26. Existing authority and persistence decisions
remain unchanged.

## Observed gap

The low-effort autonomous trial found the correct context builder path by request six, but its
search returned only isolated lines and most hits came from tests. The final tool round searched
the core collection symbol without reading the actual body. None of its eight searches was
truncated or skipped files. Separately, startup configuration capture and per-request content
refresh source had already arrived intact; the answer still omitted the re-creation requirement
and generalized read-time replacement failures to normal edits between calls.

These are different gaps: retrieval ergonomics can reduce search/read round trips, but cannot
alone establish correct lifecycle reasoning. The current default instructions already require
consumers, startup state, refresh and checking claims. Keep their bytes unchanged. Do not insert
the private question, paths, answers or rubric into prompts or tools.

## Decision

Extend the existing search capability with optional nearby source windows. This is a familiar
navigation operation: the [ripgrep 14.1.1 guide](https://github.com/BurntSushi/ripgrep/blob/14.1.1/GUIDE.md#common-options)
documents `--context` for surrounding lines. Reuse moyyi's current guarded scanner rather than
introduce a subprocess, dependency, language parser or retrieval service. No upstream code or
prompt is copied. The existing file confinement decision in ADR 0009 remains applicable.

The fs tool defaults to eight lines on each side; explicit `contextLines` supports 0–20. The
capability default remains zero for compatibility. Original hit fields remain intact. Context
windows from the same read retain exact source lines and delimiters, merge overlap/adjacency,
and carry path, line endpoints and range completeness. A window is not a semantic function
boundary or proof of a conclusion. Tests and documentation remain searchable; no guessed
relevance ranking or silent exclusion is added.

Keep the original scan, entry, file, match and tool-output limits. New context has a 64 KiB total
text ceiling within the existing output budget, with no extra file reads. The host returns whole
lines only, excludes an unverified partial scan tail, and marks incomplete ranges. Serialized
output clipping keeps whole windows; if necessary it preserves bounded navigation hits without
windows. Any omitted evidence is marked truncated. Cancellation, revocation, ignored paths,
protected files and symlink restrictions remain on the same operation path.

## Alternatives and evidence

More synonymous prompt guidance is unsupported by earlier failed trials. A model-authored
evidence checklist cannot certify its own truth. A persistent claim ledger or language-specific
graph would add state, recovery and semantic judgments before a demonstrated benefit. Increasing
model requests or adding a verifier model violates the owner's bounded trial. Nearby source is
the smallest change that addresses a concrete tool gap, with an explicit limit: it may still
fail to improve autonomous selection or interpretation.

Offline tests cover exact ranges, merge behavior, Unicode, byte limits, complete versus partial
scans, output clipping, protected/ignored/linked paths, cancellation and revocation. An actual
runtime/SQLite scenario sends source-retention/removal and captured/live-configuration fixtures
through searches into the final no-tool request, checking exact returned text rather than a
scripted answer's claimed correctness. The existing navigation-only scenario selects zero
context and retains its no-unrelated-prefix assertion.

The public lifecycle task retains every old requirement and adds a per-render configuration
factory as an opposite case, re-creation behavior, executed fixture probes and rejecting graders.
This validates fixtures, evidence transport and checkers only. Original private acceptance
criteria remain unchanged. One new autonomous trial keeps Flash + Responses + low, at most eight
requests and no retries, without supplied source or reference answers. Its actual result belongs
in the delivery record; normal completion is not factual acceptance.
