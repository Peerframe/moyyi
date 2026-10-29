---
name: moyyi-brief
description: Write a delivery brief in docs/tasks for Codex to implement as one complete delivery. Use when planning or designing moyyi work for another agent; not for implementing, reviewing or recording results.
---

# moyyi-brief

A brief turns an owner decision into one delivery that an implementer can finish without coming
back for routine questions. Claude writes briefs; Codex implements them.

## Inputs

- The owner's goal and any accepted decisions in the owning plan under `docs/tasks/`.
- Current facts from the code, not from memory: file names, sizes, extension points and the
  latest merged state. Re-check facts that a running delivery may change.
- References: the pinned DeepSeek Harness commit and package paths (see
  [moyyi-learn-from-dsh](../moyyi-learn-from-dsh/SKILL.md)), OpenBot sources already adapted,
  relevant ADRs.

## Shape

Write in Chinese (owner-facing) unless asked otherwise. Use these sections:

1. **Header**: date, owning plan, implementer, branch name, reviewer.
2. **Goal**: the user outcome and why now, with the measured current state.
3. **References**: exact repository, commit and paths to read, and what to look for in each.
4. **Unchanged boundaries**: architecture rules, defaults, limits and formats that must not move.
5. **Work**: parts lettered A, B, C... Each says what to build, where it lands in moyyi, and the
   decision already made about how. Name every place that needs an ADR.
6. **Documentation** the implementer updates, and what the reviewer updates instead.
7. **Acceptance**: one end-of-delivery list of checks, gates and live runs, with budgets.
8. **Finish, then fix**: problems that may be collected and fixed after acceptance, and the
   situations that require stopping immediately.
9. **Not in scope.**
10. **Owner decisions**, if any remain, as a table with a recommendation for each.

## Rules

- One brief, one delivery, one user outcome. Do not split work into small PRs or add approval
  checkpoints that the risks do not require.
- Think about the whole product first: check how the delivery interacts with running work,
  later deliveries and the files another delivery touches.
- State decisions; do not hand the implementer open design questions unless they are owner
  decisions.
- Every acceptance item must be checkable by someone who did not write the code.
- Link the brief from its owning plan.
