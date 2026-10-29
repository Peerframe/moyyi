# Working and project instructions

moyyi supplies a small default working prompt: inspect relevant evidence, carry out authorized
work, preserve unrelated changes, verify the result, and report what actually happened. It uses
the user's language and does not treat a tool description or a document as permission.

Analysis guidance prioritizes evidence for each requested conclusion. It follows known paths and
symbols through transformations, consumers, error handling and configuration lifetimes, using
bounded line reads around search hits instead of repeatedly fetching long file prefixes. Before
answering, the model is asked to check each claim against returned evidence, correct contradictions,
cite sources and identify unfinished verification. Sending a value, granting a permission and
refreshing configuration are distinct claims. These are model instructions, not an automatic
fact checker or a guarantee of correctness; they use the existing request budget.
The scope and validation limits are recorded in
[ADR 0022](decisions/0022-evidence-guidance-and-focused-reads.md).

The runtime also adds a recorded request-budget notice on each attempt. It states the remaining
requests including the current one and reserves the last for an answer based on existing evidence.
That final request disables new tool calls; it must distinguish verified findings from unfinished
work. The quota is unchanged and retries consume it too. A one-request budget permits no new tool
work. This execution boundary does not guarantee a correct answer; time/cancellation/context limits
can still stop the run. See [closeout details](core.md) and [ADR 0021](decisions/0021-request-budget-closeout.md).

Place project guidance in **`AGENTS.md` at the selected workspace root**. For example:

```markdown
# Project conventions
Use the existing modules before adding new ones.
Preserve unrelated changes. Run the affected tests and report their results.
Explain any verification that could not be completed.
```

The next model request reads the current root file. Editing or deleting it takes effect at the
next request, including after session restart or compaction. Files in parent/home directories,
`AGENTS.override.md`, `CLAUDE.md`, Markdown links and imports are not automatically loaded.
Nested AGENTS.md files are **not automatically loaded**: the default prompt directs the model
to discover/read applicable ones using ordinary file tools before work in that subtree. This
is guidance, not a guarantee of model obedience or a path-aware nested loader.

Project guidance is subordinate to explicit user instructions and host permissions. The model
request carries a JSON source block with `path`, `scope`, `sha256` and `text`. Content cannot enable
writes, shell, web or approval. Other file and web content remains task data.

Automatic reads require the normal read grant plus an explicit automatic-context-read policy
decision. If reads need approval, the file is not silently read; context says its rules are
unavailable. The ordinary `read` tool still follows the existing approval flow. Custom policies
must implement `beforeContextRead(path)` to opt into automatic reads. A throwing/invalid decision
denies automatic access. Restrictive plugin policy rules still apply in both phases.

The root file must be a regular UTF-8 file with a single hardlink, no symlink and at most **16 KiB**.
Missing/empty is valid. Invalid, oversized, inaccessible or protected files stop context collection
before a provider request, with a safe diagnostic; they are never silently truncated. Private
runtime data, host-protected paths and existing secret-path exclusions remain inaccessible.
`.gitignore` affects normal discovery/search; this explicitly named root file uses the explicit
read boundary. A complete request must also fit the model's existing context budget.

A trusted host can disable root-file discovery while retaining default working instructions:

```ts
const runtime = await createRuntime({
  // Existing provider, model and storage options go here.
  projectInstructions: false,
});
```

The stored rendered request records exactly what the model received. Old recordings with different
instructions fail exact replay matching; there is no live fallback. Changing instructions does
not edit stored transcripts or the persisted format. Automatic reads have no tool effects and
do not approve any action; loaded text is captured in the request audit instead.

Run `npm run eval:instructions` for deterministic context/authority conformance. No credentials,
network or real model are used; this does not measure real-model task quality. See
[ADR 0017](decisions/0017-working-and-project-instructions.md) for sources and tradeoffs.

## Optional workspace navigation

A trusted host can enable a bounded path overview before each model request:

```ts
const runtime = await createRuntime({
  // Existing provider, model and storage options go here.
  workspaceNavigation: true,
});
```

The default is off. Enabling it lists regular file paths without reading source bodies; bounded
.gitignore files are read to apply discovery exclusions. Paths are untrusted navigation, not
facts or instructions. The model still needs to inspect relevant files. The scan respects
protected paths, ignores, cancellation and operation-specific permissions. Custom policies must
allow `beforeContextRead(path, "list")` and normal list preparation, plus read grants for necessary
ignore-file checks; a missing hook, ask or deny cannot become approval. Plugin restrictions apply
in both phases. Unavailable means unknown, not empty.

Limits are 200 paths, 8 KiB of serialized result data, depth four, 10,000 visited entries and 64
admitted directories including the root. Truncation/skipped entries are explicit; an omitted path
is not proof of absence. The overview refreshes for every request; the enable flag is captured at
runtime startup. Changing it requires a new runtime. It grants no writes, shell or network access.

The whole section may be omitted when it would exceed the existing context limit. Required
instructions, history, tools and final-request restrictions are retained; a required request that
still does not fit fails as before. Context reports identify omitted optional sections. Recorded
requests retain exactly the admitted context. The offline instruction eval includes a four-request
scripted read/create/verify/final workflow with the original public checker; this does not measure
real-model accuracy. See [ADR 0027](decisions/0027-bounded-workspace-navigation.md).

## Stable runtime facts

Runtime contributes a `session` section between static identity/safety and turn-level sources.
It states the session date, host IANA time zone, operating system, selected workspace and actual
provider/model. The date comes from the first recorded entry, so reopening does not silently
turn it into a new session. The label says this is a stable snapshot, not a live clock. Host
facts are captured once for the current session/model composition; no environment variables,
credentials, home-directory inventory or inferred capabilities are included. The exact section
is included in every recorded model request. Changing model or host environment can change this
section; ordinary next-step requests preserve its prefix.
