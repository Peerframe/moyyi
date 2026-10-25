# Default working instructions

`defaultInstructionsPlugin` contributes one static context section. It gives moyyi a small,
model-independent working baseline: understand the task, inspect relevant evidence, carry out
authorized work, verify results, preserve unrelated changes, and report outcomes honestly.

For analysis, the guidance maps requested conclusions to evidence, follows known symbols through
their consumers and error handlers, and uses bounded reads around search hits. It distinguishes
payload transmission from authorization and refresh lifetimes, then asks for a final check of
claims against returned evidence. Independent reads may share a response; no extra model round,
automatic verifier, new permission or increased request budget is introduced. Truncated output
cannot prove absence, and reading test code is not execution evidence.

Source explanations cover each requested question before expanding detail. Claims retain their
conditions and timing: a missing parsed field is not necessarily missing from raw output, and
startup selection, between-request refresh and during-read races are separate observations.
Findings should not be restated with broader wording in recaps or unsolicited redesign advice.
This is guidance for the model, not a semantic validator or a guarantee of factual correctness.

The instructions distinguish tool availability from permission and ordinary external content
from instructions. They explain the root-only automatic project instruction support and tell
the model to inspect applicable nested `AGENTS.md` files through ordinary file tools before
working in a subdirectory. A nested file applies only to its own subtree.

The plugin performs no I/O, accepts no configuration, and registers no tools or policy rules.
Its text cannot grant authority or replace the executor's policy, approvals, cancellation,
or budgets. Changing the wording requires behavior/eval evidence, not merely a text snapshot.

Unit checks verify registration, cancellation, a stable section, no capability use, and the
important behavioral boundaries. They do not prove that a live model will obey the guidance.
