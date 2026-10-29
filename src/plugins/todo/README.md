# Todo list

`todoPlugin` registers `todo_write` for tasks with at least three steps or multiple user
requirements. Each successful call supplies the complete replacement list. Mark each requirement
with a concrete task and update its status as work proceeds. An empty list clears the plan.

## Usage and implementation

The tool accepts only `{ todos: [{ content, status }] }`, with status `pending`, `in_progress`
or `completed`. Content is trimmed before validation, must be nonempty valid text, and must be
unique after trimming (case-sensitive). At most one task may be `in_progress`. Extra properties
are rejected on both the outer object and each item. No plugin configuration is accepted.

The plugin uses the ordinary argument-byte budget and output limit. Preparation validates and
copies the list; execution validates its prepared payload and produces counts. It performs no
filesystem, process, network or store I/O, and retains no mutable list between calls or runs.
The latest successful call in the session history defines the current list; older calls remain
as history. Cancellation is checked in both phases.

The effect class is `read`: this records planning information through the executor's ordinary
call/result journal and does not change external state. It acquires no write permission and
does not bypass the existing read policy or approval path. No new persisted format, separate
todo state, context source or read-back tool is added.

## Model experience

The stable schema and tool description appear on each request where the tool is registered.
The description asks the model to map multiple user requirements to todos, keep at most one
task active, and check off each completed task. Each call's full arguments remain in history;
there is no second injection of the list into the system prompt or later turns.

Success returns exactly one line:

```text
Updated todo list: <pending> pending, <in_progress> in progress, <completed> completed.
```

Semantic validation uses these fixed error messages; the executor may frame them as a
preparation failure. Invalid JSON or a schema mismatch is rejected by the ordinary argument
validator before preparation.

```text
invalid todos: expected an object containing only the todos array
invalid todo: expected only content and status
invalid todo: content must be non-empty valid text
invalid todos: duplicate content
invalid todo: status must be pending, in_progress or completed
invalid todos: at most one task may be in_progress
```

The schema has a fixed per-request token cost. Call-history cost grows with the full list on
each update; the result is a short count summary. Updates append to history, preserving the
earlier reusable prefix. Adding or removing the plugin changes the tool-schema prefix.

## Known limits

- A todo is the model's progress claim, not independent proof that its requirement is satisfied.
- After explicit compaction, the model retains the latest list only through the compaction
  summary. The compaction prompt must preserve that list, its statuses and unmet requirements;
  the original call records remain available in the session history.
- There is no separate UI or shared list. This delivery uses the single-active discipline.

## Source

Validation, whole-list updates and the count-summary shape are adapted from
DeepSeek Harness `packages/todo/tool-todo/src/index.ts` and its README/tests at
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`, Copyright (c) 2026 DeepSeek, MIT.
The permission notice is retained in [DEEPSEEK-LICENSE.txt](DEEPSEEK-LICENSE.txt).
Cordis, session projections and upstream dependencies are not imported.
