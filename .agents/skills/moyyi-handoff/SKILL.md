---
name: moyyi-handoff
description: Keep a delivery resumable by checkpointing progress, and resume one started by another account or model (Claude or Codex). Use at every checkpoint, when usage is running out, when told to stop, and when picking up a delivery branch; not for writing the original brief.
---

# moyyi-handoff

A paid plan can run out in the middle of a delivery. Work must be able to stop at any point and
continue under another account or another model with nothing lost and nothing paid twice.

## The handoff file

Each delivery branch has one file, committed on that branch:
`.agents/handoff/<branch-name-with-slashes-replaced-by-dashes>.md`. It records:

```markdown
# Handoff: <delivery name>
- Brief: docs/tasks/<brief>.md
- Branch / last checkpoint commit: <branch> / <sha>
- Last agent: <Claude|Codex>, <date and time>

## Done
- <part letter>: <what is finished and how it was checked>

## In progress
- <part>: <what exists, what is missing, the exact next step>

## Collected problems (fix pass)
- <problem>, <where>, <how it was noticed>

## Commands run
- <command>: <result>

## Paid usage ledger
- Frozen budget: <requests / cost>
- Spent: <run, date, tasks, requests>; remaining: <requests>

## Decisions taken / waiting for the owner
```

The file is a working record for the delivery. Remove it in the final commit before the PR is
merged, after moving anything durable to the delivery record.

## Checkpoint (while working)

At the end of each lettered part of the brief, and before any paid run:

1. Update the handoff file.
2. Commit everything on the delivery branch with a message starting `wip:`. Do not open a PR or
   merge; the delivery is still one PR at the end.
3. Push the branch if a remote exists, so another machine can continue.

## Stopping (quota low, or told to stop)

1. Stop starting new work. Let a running command finish or cancel it; never leave a paid run
   half-recorded.
2. Write the exact next step and any uncommitted reasoning into **In progress**.
3. Checkpoint as above.
4. Tell the owner the branch, the commit and the one-line next step.

If the session is cut off before this, the next agent rebuilds the state from the last handoff
file, `git log` and `git status`.

## Resuming (new account or model)

1. Read `AGENTS.md`, the brief, then the handoff file. The brief stays the authority; do not
   re-plan or re-decide what it settles.
2. Check the real state: `git status`, `git log <base>..HEAD`, and the focused tests for the
   parts marked done. Trust the code and tests over the file when they disagree, and correct
   the file.
3. Never repeat a paid run listed in the ledger. Spend only what remains of the frozen budget.
4. Continue from **In progress**, keeping the same collected-problems list.
5. Record yourself as the last agent at the next checkpoint.

## Switching models

Claude and Codex read the same skills (`.agents/skills`, linked from `.claude/skills`) and the
same `AGENTS.md`, so either can continue the other's implementation. The roles in `AGENTS.md`
remain the default; a switch for quota reasons does not change who reviews and accepts.
