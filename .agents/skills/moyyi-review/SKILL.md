---
name: moyyi-review
description: Review a fixed moyyi diff or PR for correctness, authority, persisted formats, architecture boundaries and honest evidence. Use for code review or delivery acceptance; do not implement a competing patch.
---

# moyyi-review

## Inputs

The verified base and head (or an explicit working-tree diff), the brief it implements, and the
evidence the PR claims.

## Steps

1. Read the brief's goal, boundaries and acceptance list first.
2. Read the diff and enough surrounding code to understand the design, not only the changed lines.
3. Check, in this order:
   - **Correctness** of the behavior the brief asked for, including cancellation, interruption
     and recovery paths.
   - **Authority**: no wider grants, looser limits, new escape hatches in IPC or file access, or
     model-supplied text treated as permission.
   - **Formats**: no unplanned change to `src/contracts/persisted` or settings; migrations and
     backup/restore covered when a format changes.
   - **Boundaries**: imports follow `tests/boundaries.ts`; capabilities live in plugins; core
     changes have an ADR.
   - **Model experience**: model-visible changes are recorded, documented and backed by eval
     evidence.
   - **Evidence**: claims match what ran. Implemented, installed, offline-tested and
     live-verified are not interchangeable.
   - **Provenance** for copied or adapted code.
4. Re-run the checks that matter for acceptance rather than trusting the PR text.

## Output

For each finding: file and line, what goes wrong in a concrete scenario, and the needed fix.
Mark each as **blocking** or **fix in the collected pass**. One substantiated blocker is more
useful than many style notes. End with a verdict: accept, accept after the fix pass, or rework.
